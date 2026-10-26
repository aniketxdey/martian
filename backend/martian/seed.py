"""Bootstrap an organization and its first owner.

martian-seed --org "Acme" --domain acme.com --email ops@acme.com --password '...'
martian-seed --demo     # demo tenant: admin@company.com / admin123 with a sandbox connector
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re

from sqlalchemy import select

from martian.db.base import org_session, system_session
from martian.db.models import Connector, Integration, Membership, Organization, Role, Server, User
from martian.jobs.queue import enqueue
from martian.security.auth import hash_password, hash_token

DEMO_TOKEN = "mct_demo_sandbox_connector_token_do_not_use_in_production"


async def create_org(name: str, email: str, password: str, domain: str | None = None) -> Organization:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    async with system_session() as s:
        org = (await s.execute(select(Organization).where(Organization.slug == slug))).scalar_one_or_none()
        if org is None:
            org = Organization(name=name, slug=slug, email_domain=domain)
            s.add(org)
            await s.flush()
        user = (await s.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none()
        if user is None:
            user = User(
                email=email.lower(), name=email.split("@")[0].title(), password_hash=hash_password(password)
            )
            s.add(user)
            await s.flush()
        if await s.get(Membership, (org.id, user.id)) is None:
            s.add(Membership(org_id=org.id, user_id=user.id, role=Role.owner.value))
        return org


async def seed_demo() -> Organization:
    org = await create_org("Company, Inc.", "admin@company.com", "admin123", "company.com")
    token = os.environ.get("MARTIAN_DEMO_CONNECTOR_TOKEN", DEMO_TOKEN)
    async with org_session(org.id) as s:
        connector = (await s.execute(select(Connector).where(Connector.org_id == org.id))).scalars().first()
        if connector is None:
            connector = Connector(
                org_id=org.id,
                name="Sandbox connector",
                token_hash=hash_token(token),
                token_prefix=token[:12],
                sandbox=True,
            )
            s.add(connector)
            await s.flush()
        existing = {
            i.kind
            for i in (await s.execute(select(Integration).where(Integration.org_id == org.id))).scalars()
        }
        specs = [
            (
                "aws",
                "Amazon Web Services",
                "ask",
                {"accounts": [{"account_id": "123456789012"}], "regions": ["us-east-1", "us-west-2"]},
            ),
            (
                "azure",
                "Microsoft Azure",
                "ask",
                {"subscription_ids": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]},
            ),
            ("gcp", "Google Cloud", "ask", {"project_ids": ["enterprise-project-384721"]}),
            ("vcenter", "VMware vCenter", "read", {"url": "https://vcenter.corp.local"}),
            ("ssh", "Physical servers", "ask", {}),
        ]
        ssh_id = None
        for kind, name, mode, config in specs:
            if kind in existing:
                continue
            i = Integration(
                org_id=org.id, kind=kind, name=name, mode=mode, config=config, connector_id=connector.id
            )
            s.add(i)
            await s.flush()
            if kind == "ssh":
                ssh_id = i.id
        if ssh_id:
            s.add(
                Server(
                    org_id=org.id,
                    integration_id=ssh_id,
                    name="Production Server 01",
                    ip_address="192.168.1.100",
                    username="admin",
                    description="Main production server",
                    os="Ubuntu 20.04 LTS",
                )
            )
        await enqueue(s, "scan", {"trigger": "seed"}, org_id=org.id, dedupe_key=f"scan:{org.id}")
    return org


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--demo", action="store_true")
    p.add_argument("--org")
    p.add_argument("--domain")
    p.add_argument("--email")
    p.add_argument("--password")
    a = p.parse_args()
    if a.demo:
        org = await seed_demo()
    else:
        if not (a.org and a.email and a.password):
            p.error("--org, --email and --password are required (or use --demo)")
        org = await create_org(a.org, a.email, a.password, a.domain)
    print(f"organization ready: {org.name} ({org.id})")


def run() -> None:
    asyncio.run(main())
