"""Test harness: a real Postgres database migrated by the owner role, used by the
non-owner app role so row-level security is exercised exactly as in production.

Requires a Postgres server; set MARTIAN_TEST_PG (superuser DSN), default
postgresql://postgres@127.0.0.1:5432/postgres.
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

PG = os.environ.get("MARTIAN_TEST_PG", "postgresql://postgres@127.0.0.1:5432/postgres")
DB = f"martian_test_{os.getpid()}"
HOST = PG.split("@", 1)[1].split("/", 1)[0]

os.environ["MARTIAN_DATABASE_URL"] = f"postgresql+psycopg://martian_app:martian@{HOST}/{DB}"
os.environ["MARTIAN_MIGRATION_DATABASE_URL"] = f"postgresql+psycopg://martian_owner:martian@{HOST}/{DB}"
os.environ["MARTIAN_WEB_ORIGIN"] = "http://testserver"
os.environ["MARTIAN_API_PUBLIC_URL"] = "http://testserver"
os.environ.pop("ANTHROPIC_API_KEY", None)


def _admin(sql: str) -> None:
    with psycopg.connect(PG, autocommit=True) as conn:
        conn.execute(sql)


@pytest.fixture(scope="session", autouse=True)
def database():
    for role in ("martian_owner", "martian_app"):
        _admin(
            f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
            f"THEN CREATE ROLE {role} LOGIN PASSWORD 'martian'; END IF; END $$"
        )
    _admin(f"DROP DATABASE IF EXISTS {DB}")
    _admin(f"CREATE DATABASE {DB} OWNER martian_owner")
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    command.upgrade(cfg, "head")
    yield
    _admin(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")


@pytest.fixture(scope="session")
async def app():
    from asgi_lifespan import LifespanManager

    from martian.api.main import create_app

    application = create_app()
    async with LifespanManager(application):
        yield application


@pytest.fixture
async def client(app):
    import httpx

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as c:
        yield c


@pytest.fixture
async def tenant():
    """A fresh organization with an owner, a connector and AWS + vCenter integrations."""
    from martian.db.base import org_session
    from martian.db.models import Connector, Integration
    from martian.security.auth import hash_token
    from martian.seed import create_org

    suffix = uuid.uuid4().hex[:8]
    org = await create_org(f"Acme {suffix}", f"owner-{suffix}@acme.test", "correct horse battery")
    async with org_session(org.id) as s:
        c = Connector(
            org_id=org.id,
            name="test",
            token_hash=hash_token(f"tok-{suffix}"),
            token_prefix="tok",
            sandbox=True,
            status="online",
        )
        s.add(c)
        await s.flush()
        aws = Integration(
            org_id=org.id, kind="aws", name="AWS", connector_id=c.id, mode="ask", status="connected"
        )
        vc = Integration(
            org_id=org.id, kind="vcenter", name="vCenter", connector_id=c.id, mode="read", status="connected"
        )
        s.add_all([aws, vc])
        await s.flush()
        ids = {"org": org.id, "connector": c.id, "aws": aws.id, "vcenter": vc.id}
    return {**ids, "email": f"owner-{suffix}@acme.test", "password": "correct horse battery"}


@pytest.fixture
def backend():
    from tests.fakes import FakeBackend

    return FakeBackend()


@pytest.fixture
async def signed_in(client, tenant):
    r = await client.post("/auth/login", json={"email": tenant["email"], "password": tenant["password"]})
    assert r.status_code == 200, r.text
    return tenant
