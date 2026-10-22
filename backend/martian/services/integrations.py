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
        "desc": "EC2, EBS, RDS, load balancers, NAT gateways, Auto Scaling and Cost Explorer.",
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
        "desc": "VMs, managed disks and Cost Management for your subscriptions.",
        "config_fields": [{"key": "subscription_ids", "label": "Subscription IDs", "type": "list"}],
    },
    {
        "kind": "gcp",
        "cat": "cloud",
        "mono": "GCP",
        "name": "Google Cloud",
        "transport": "connector",
        "desc": "Compute Engine, persistent disks and Cloud Monitoring.",
        "config_fields": [{"key": "project_ids", "label": "Project IDs", "type": "list"}],
    },
    {
        "kind": "vcenter",
        "cat": "infra",
        "mono": "VC",
        "name": "VMware vCenter",
        "transport": "connector",
        "desc": "Hosts, clusters, VMs and datastores in your data center.",
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
        "desc": "Requests, limits and node pool utilization across clusters.",
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
