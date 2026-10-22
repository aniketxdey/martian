"""One-shot database bootstrap: ensure the app role exists, then run migrations.

Runs as the owner role (MARTIAN_MIGRATION_DATABASE_URL, e.g. the RDS master user).
The API and worker connect as `martian_app`, which owns nothing, so FORCE ROW LEVEL
SECURITY applies to every query they make.

    MARTIAN_APP_DB_PASSWORD=... martian-migrate
"""

from __future__ import annotations

import os
from pathlib import Path

import structlog
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from martian.config import get_settings

log = structlog.get_logger()
APP_ROLE = "martian_app"


def ensure_app_role(owner_url: str, password: str | None) -> None:
    engine = create_engine(owner_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as c:
        exists = c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": APP_ROLE}).scalar()
        if not exists:
            if not password:
                raise SystemExit(f"role {APP_ROLE} is missing; set MARTIAN_APP_DB_PASSWORD to create it")
            # Identifiers and passwords cannot be bound parameters in DDL; quote via Postgres.
            pw = c.execute(text("SELECT quote_literal(:p)"), {"p": password}).scalar()
            c.execute(text(f"CREATE ROLE {APP_ROLE} LOGIN PASSWORD {pw} NOSUPERUSER NOBYPASSRLS"))
            log.info("created_app_role", role=APP_ROLE)
        db = make_url(owner_url).database
        c.execute(text(f'GRANT CONNECT ON DATABASE "{db}" TO {APP_ROLE}'))
    engine.dispose()


def run() -> None:
    s = get_settings()
    owner_url = s.migration_database_url or s.database_url
    ensure_app_role(owner_url, os.environ.get("MARTIAN_APP_DB_PASSWORD") or s.db_app_password)
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "migrations"))
    command.upgrade(cfg, "head")
    log.info("migrations_applied")
    if s.seed_demo:
        import asyncio

        from martian.seed import seed_demo

        org = asyncio.run(seed_demo())
        log.info("demo_seeded", org=str(org.id))


if __name__ == "__main__":
    run()
