"""Integration catalog and the configuration a connector receives over its tunnel."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.config import get_settings
from martian.db.models import Connector, Integration, Server
from martian.security.crypto import decrypt, decrypt_json

log = structlog.get_logger()

# Kinds a connector can host today, plus proposed ones shown as "coming soon".
CATALOG: list[dict[str, Any]] = [
    {
        "kind": "aws",
        "cat": "cloud",
        "mono": "AWS",
        "name": "Amazon Web Services",
        "transport": "connector",
        "desc": "EC2 and RDS fleets with the volumes and load balancers around them, priced with Cost Explorer.",
        "config_fields": [
            {"key": "accounts", "label": "Accounts (role ARNs)", "type": "list"},
            {"key": "regions", "label": "Regions", "type": "list"},
        ],
    },
    {
        "kind": "azure",
        "cat": "cloud",
        "mono": "AZ",
        "name": "Microsoft Azure",
        "transport": "connector",
        "desc": "VMs and SQL databases across your subscriptions, priced with Cost Management.",
        "config_fields": [{"key": "subscription_ids", "label": "Subscription IDs", "type": "list"}],
    },
    {
        "kind": "gcp",
        "cat": "cloud",
        "mono": "GCP",
        "name": "Google Cloud",
        "transport": "connector",
        "desc": "Compute Engine and Cloud SQL, with utilization from Cloud Monitoring.",
        "config_fields": [{"key": "project_ids", "label": "Project IDs", "type": "list"}],
    },
    {
        "kind": "vcenter",
        "cat": "infra",
        "mono": "VC",
        "name": "VMware vCenter",
        "transport": "connector",
        "desc": "Every host and VM in your data center, grouped by cluster.",
        "config_fields": [
            {"key": "url", "label": "vCenter URL", "type": "text"},
            {"key": "username", "label": "Username", "type": "text"},
            {"key": "password", "label": "Password", "type": "secret"},
        ],
    },
    {
        "kind": "ssh",
        "cat": "infra",
        "mono": "SSH",
        "name": "Physical servers",
        "transport": "connector",
        "desc": "SSH access to on-premises machines. Servers are managed in Settings.",
        "config_fields": [],
    },
    {
        "kind": "custom",
        "cat": "custom",
        "mono": "MCP",
        "name": "Custom MCP server",
        "transport": "http",
        "desc": "Any MCP server reachable over Streamable HTTP.",
        "config_fields": [
            {"key": "url", "label": "Server URL", "type": "text"},
            {"key": "authorization", "label": "Authorization header", "type": "secret"},
        ],
    },
]
COMING_SOON: list[dict[str, Any]] = [
    {
        "kind": "k8s",
        "cat": "infra",
        "mono": "K8S",
        "name": "Kubernetes",
        "desc": "Pod requests against real usage, and how full each node pool is.",
    },
    {
        "kind": "terraform",
        "cat": "infra",
        "mono": "TF",
        "name": "Terraform",
        "desc": "Propose fixes as plans and pull requests instead of direct changes.",
    },
    {
        "kind": "datadog",
        "cat": "obs",
        "mono": "DD",
        "name": "Datadog",
        "desc": "Utilization and APM data to confirm a resource is really idle.",
    },
    {
        "kind": "slack",
        "cat": "collab",
        "mono": "SL",
        "name": "Slack",
        "desc": "Send findings to owners and collect approvals in a channel.",
    },
    {
        "kind": "jira",
        "cat": "collab",
        "mono": "JI",
        "name": "Jira",
        "desc": "Open tickets for changes that need another team.",
    },
]
KINDS = {c["kind"]: c for c in CATALOG}


def aws_external_id(org_id: uuid.UUID) -> str:
    """ExternalId customers put in their IAM role trust policy (confused-deputy protection).

    One per organization, so a role created for one Martian customer cannot be assumed on
    behalf of another even if its ARN leaks.
    """
    return f"martian-{org_id}"


def aws_config_with_external_id(org_id: uuid.UUID, config: dict[str, Any]) -> dict[str, Any]:
    accounts = [
        {**a, "external_id": aws_external_id(org_id)} if isinstance(a, dict) and a.get("role_arn") else a
        for a in config.get("accounts", [])
    ]
    return {**config, "accounts": accounts}


async def connector_config(s: AsyncSession, connector: Connector) -> list[dict[str, Any]]:
    """Integrations served by this connector, with secrets the connector may receive.

    Secrets typed into the UI are delivered only to the connector bound to that
    integration. Cloud credentials normally never pass through Martian at all: the
    connector uses its own identity (instance role, managed identity, workload identity).
    """
    rows = (await s.execute(select(Integration).where(Integration.connector_id == connector.id))).scalars()
    out = []
    for i in rows:
        if i.kind == "custom" and (i.config or {}).get("transport") != "stdio":
            continue  # HTTP custom servers are called directly, not through a connector
        entry: dict[str, Any] = {
            "id": str(i.id),
            "kind": i.kind,
            "name": i.name,
            "enabled": i.enabled,
            "config": i.config or {},
            "secrets": decrypt_json(i.secrets_ciphertext),
        }
        if i.kind == "aws":
            entry["config"] = aws_config_with_external_id(i.org_id, entry["config"])
        if i.kind == "ssh":
            servers = (await s.execute(select(Server).where(Server.integration_id == i.id))).scalars()
            entry["config"] = {
                **entry["config"],
                "hosts": [
                    {
                        "id": str(h.id),
                        "name": h.name,
                        "host": h.ip_address,
                        "username": h.username,
                        "os": h.os,
                        "password": decrypt(h.password_ciphertext) if h.password_ciphertext else None,
                    }
                    for h in servers
                ],
            }
        out.append(entry)
    return out


async def notify_gateway(connector_id: uuid.UUID | None) -> None:
    """Ask the gateway to push fresh configuration to a connected connector (best effort)."""
    if connector_id is None:
        return
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5) as http:
            await http.post(
                f"{s.gateway_url.rstrip('/')}/internal/connectors/{connector_id}/refresh",
                headers={"Authorization": f"Bearer {s.internal_token}"},
            )
    except httpx.HTTPError as exc:
        log.info("gateway_refresh_skipped", connector=str(connector_id), error=str(exc))


def validate_custom_url(url: str | None, *, allow_private: bool) -> str:
    """Early validation of a custom MCP server URL (the gateway enforces it again per request).

    Hosted Martian only reaches public HTTPS endpoints; private servers belong behind a
    connector (stdio transport) instead.
    """
    import ipaddress
    from urllib.parse import urlsplit

    if not url:
        raise ValueError("Add the server URL.")
    parts = urlsplit(url.strip())
    if parts.scheme not in ({"https", "http"} if allow_private else {"https"}):
        raise ValueError("Custom MCP servers have to use https.")
    if not parts.hostname:
        raise ValueError("That server URL has no host.")
    if parts.username or parts.password:
        raise ValueError("Put credentials in the Authorization header, not in the URL.")
    if not allow_private:
        host = parts.hostname
        if host == "localhost" or host.endswith((".localhost", ".internal", ".local")):
            raise ValueError(f"{host} isn't a public host.")
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            ip = None
        if ip is not None and not ip.is_global:
            raise ValueError(f"{host} isn't a public address.")
    return url.strip()


def normalize_aws_accounts(accounts: object) -> list[dict[str, str]]:
    """Accept role ARNs or 12-digit account IDs (strings or objects); return objects."""
    import re

    if not isinstance(accounts, list):
        raise ValueError("Accounts have to be a list.")
    out: list[dict[str, str]] = []
    for a in accounts:
        item = {"role_arn": a} if isinstance(a, str) and a.startswith("arn:") else a
        if isinstance(item, str):
            item = {"account_id": item}
        if not isinstance(item, dict):
            raise ValueError(f"{a!r} isn't a valid account.")
        arn = item.get("role_arn")
        if arn:
            m = re.fullmatch(r"arn:aws[a-z-]*:iam::(\d{12}):role/[\w+=,.@/-]+", arn)
            if not m:
                raise ValueError(f"{arn} isn't an IAM role ARN.")
            item = {**item, "account_id": m.group(1)}
        elif not re.fullmatch(r"\d{12}", str(item.get("account_id", ""))):
            raise ValueError(f"{a!r} isn't a role ARN or a 12-digit account ID.")
        item.pop("external_id", None)  # always derived from the organization
        out.append(item)
    return out
