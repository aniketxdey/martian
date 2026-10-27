"""Integrations (MCP servers), their tools and policies, and connectors."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.config import get_settings
from martian.db.base import org_session, utcnow
from martian.db.models import Action, Connector, Integration, Role
from martian.security.auth import new_connector_token
from martian.security.crypto import encrypt
from martian.services import audit
from martian.services.integrations import (
    CATALOG,
    COMING_SOON,
    KINDS,
    aws_external_id,
    normalize_aws_accounts,
    notify_gateway,
    validate_custom_url,
)
from martian.services.mcp import MCPBackend

router = APIRouter(tags=["integrations"])


def _integration(i: Integration, connectors: dict[uuid.UUID, Connector]) -> dict[str, Any]:
    c = connectors.get(i.connector_id) if i.connector_id else None
    meta = KINDS.get(i.kind, {})
    online = c is not None and c.status == "online"
    status = (
        "disabled"
        if not i.enabled
        else ("offline" if c is not None and not online and i.kind != "custom" else i.status)
    )
    return {
        "id": str(i.id),
        "kind": i.kind,
        "name": i.name,
        "mono": meta.get("mono", "MCP"),
        "cat": meta.get("cat", "custom"),
        "desc": meta.get("desc", ""),
        "status": status,
        "enabled": i.enabled,
        "mode": i.mode,
        "transport": "local · stdio" if (i.config or {}).get("transport") == "stdio" else "remote · https",
        "connector": {"id": str(c.id), "name": c.name, "status": c.status, "sandbox": c.sandbox}
        if c
        else None,
        "config": {k: v for k, v in (i.config or {}).items() if k not in {"password", "authorization"}},
        "external_id": aws_external_id(i.org_id) if i.kind == "aws" else None,
        "has_secrets": bool(i.secrets_ciphertext),
        "tools": [{**t, "enabled": t["name"] not in (i.disabled_tools or [])} for t in (i.tools or [])],
        "last_sync_at": i.last_sync_at.isoformat() if i.last_sync_at else None,
        "last_error": i.last_error,
    }


async def _connectors(s: AsyncSession, org_id: uuid.UUID) -> dict[uuid.UUID, Connector]:
    return {c.id: c for c in (await s.execute(select(Connector).where(Connector.org_id == org_id))).scalars()}


@router.get("/integrations")
async def list_integrations(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = list(
        (
            await s.execute(
                select(Integration).where(Integration.org_id == p.org_id).order_by(Integration.created_at)
            )
        ).scalars()
    )
    connectors = await _connectors(s, p.org_id)
    return {
        "integrations": [_integration(i, connectors) for i in rows],
        "available": [{k: v for k, v in c.items()} for c in CATALOG],
        "coming_soon": COMING_SOON,
    }


@router.get("/integrations/{integration_id}")
async def get_integration(
    integration_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    i = await s.get(Integration, integration_id)
    if i is None:
        raise HTTPException(404, "That integration doesn't exist.")
    calls = (
        await s.execute(
            select(Action).where(Action.integration_id == i.id).order_by(Action.created_at.desc()).limit(20)
        )
    ).scalars()
    return {
        **_integration(i, await _connectors(s, p.org_id)),
        "recent_calls": [
            {"at": a.created_at.isoformat(), "agent": a.requested_by, "tool": a.tool, "status": a.status}
            for a in calls
        ],
    }


def _check_config(kind: str, config: dict[str, Any]) -> None:
    if kind == "aws" and "accounts" in config:
        try:
            config["accounts"] = normalize_aws_accounts(config["accounts"])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if kind == "custom" and config.get("transport") != "stdio":
        try:
            config["url"] = validate_custom_url(
                config.get("url"), allow_private=get_settings().allow_private_egress
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


class CreateIntegration(BaseModel):
    kind: str
    name: str | None = None
    connector_id: uuid.UUID | None = None
    mode: Literal["read", "ask", "auto"] = "ask"
    config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)


@router.post("/integrations", status_code=201)
async def create_integration(
    body: CreateIntegration, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    if body.kind not in KINDS:
        raise HTTPException(400, f"Martian doesn't support the integration kind {body.kind!r}.")
    _check_config(body.kind, body.config)
    connectors = await _connectors(s, p.org_id)
    connector_id = body.connector_id
    if body.kind != "custom" or body.config.get("transport") == "stdio":
        if connector_id is None:
            connector_id = next(iter(connectors), None)
        if connector_id not in connectors:
            raise HTTPException(400, "Create a connector first, then attach this integration to it.")
    i = Integration(
        org_id=p.org_id,
        kind=body.kind,
        name=body.name or KINDS[body.kind]["name"],
        connector_id=connector_id,
        mode=body.mode,
        config=body.config,
        secrets_ciphertext=encrypt(body.secrets) if body.secrets else None,
        status="pending",
    )
    s.add(i)
    await s.flush()
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "integration.created",
        target_type="integration",
        target_id=str(i.id),
        summary=f"added {i.name}",
    )
    await s.commit()
    await notify_gateway(connector_id)
    return _integration(i, connectors)


class UpdateIntegration(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    mode: Literal["read", "ask", "auto"] | None = None
    disabled_tools: list[str] | None = None
    config: dict[str, Any] | None = None
    secrets: dict[str, str] | None = None


@router.patch("/integrations/{integration_id}")
async def update_integration(
    integration_id: uuid.UUID,
    body: UpdateIntegration,
    p: Principal = Depends(require(Role.admin)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    i = await s.get(Integration, integration_id)
    if i is None:
        raise HTTPException(404, "That integration doesn't exist.")
    if body.config is not None:
        _check_config(i.kind, body.config)
    changes = body.model_dump(exclude_none=True, exclude={"secrets"})
    for k, v in changes.items():
        setattr(i, k, v)
    if body.secrets is not None:
        i.secrets_ciphertext = encrypt(body.secrets) if body.secrets else None
        changes["secrets"] = "updated"
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "integration.updated",
        target_type="integration",
        target_id=str(i.id),
        summary=f"updated {i.name}",
        details={k: v for k, v in changes.items() if k != "config"},
    )
    connectors = await _connectors(s, p.org_id)
    out = _integration(i, connectors)
    await s.commit()
    if body.config is not None or body.secrets is not None or body.enabled is not None:
        await notify_gateway(i.connector_id)
    return out


@router.delete("/integrations/{integration_id}")
async def delete_integration(
    integration_id: uuid.UUID,
    p: Principal = Depends(require(Role.admin)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    i = await s.get(Integration, integration_id)
    if i is None:
        raise HTTPException(404, "That integration doesn't exist.")
    connector_id, name = i.connector_id, i.name
    await s.delete(i)
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "integration.deleted",
        target_type="integration",
        target_id=str(integration_id),
        summary=f"disconnected {name}",
    )
    await s.commit()
    await notify_gateway(connector_id)
    return {"deleted": True}


@router.post("/integrations/{integration_id}/test")
async def test_integration(integration_id: uuid.UUID, p: Principal = Depends(require(Role.admin))) -> dict:
    backend = MCPBackend(p.org_id, timeout=30)
    async with org_session(p.org_id) as s:
        i = await s.get(Integration, integration_id)
        if i is None:
            raise HTTPException(404, "That integration doesn't exist.")
        kind = i.kind
    try:
        tools = await backend.list_tools(str(integration_id))
        verify = next((t["name"] for t in tools if t["name"].endswith("_verify_access")), None)
        detail = await backend.call_tool(str(integration_id), verify, {}) if verify else {"tools": len(tools)}
        ok, error = True, None
    except Exception as exc:  # noqa: BLE001
        tools, detail, ok, error = None, None, False, str(exc)
    async with org_session(p.org_id) as s:
        i = await s.get(Integration, integration_id)
        assert i is not None
        if tools is not None:
            i.tools = tools
        i.status = "connected" if ok else ("auth" if error and "credential" in error.lower() else "error")
        i.last_error = error
        if ok:
            i.last_sync_at = utcnow()
        await audit.record(
            s,
            p.org_id,
            p.actor,
            "integration.tested",
            target_type="integration",
            target_id=str(integration_id),
            summary=f"tested {kind}: {'ok' if ok else 'failed'}",
        )
    return {"ok": ok, "error": error, "detail": detail}


# ---- connectors


class CreateConnector(BaseModel):
    name: str = "Primary connector"
    sandbox: bool = False


@router.get("/connectors")
async def list_connectors(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = (
        await s.execute(select(Connector).where(Connector.org_id == p.org_id).order_by(Connector.created_at))
    ).scalars()
    return {
        "connectors": [
            {
                "id": str(c.id),
                "name": c.name,
                "status": c.status,
                "sandbox": c.sandbox,
                "version": c.version,
                "token_prefix": c.token_prefix,
                "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None,
            }
            for c in rows
        ]
    }


@router.post("/connectors", status_code=201)
async def create_connector(
    body: CreateConnector, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    token, token_hash, prefix = new_connector_token()
    c = Connector(
        org_id=p.org_id, name=body.name, token_hash=token_hash, token_prefix=prefix, sandbox=body.sandbox
    )
    s.add(c)
    await s.flush()
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "connector.created",
        target_type="connector",
        target_id=str(c.id),
        summary=f"created connector {c.name}",
    )
    cfg = get_settings()
    gw = cfg.public_connector_url
    return {
        "id": str(c.id),
        "name": c.name,
        "token": token,
        "gateway_url": gw,
        "install": {
            "docker": (
                f"docker run -d --name martian-connector --restart unless-stopped "
                f"-e MARTIAN_CONNECTOR_TOKEN={token} -e MARTIAN_GATEWAY_URL={gw} {cfg.connector_image}"
            ),
            "helm": (
                f"helm install martian-connector {cfg.connector_chart} --namespace martian --create-namespace "
                f"--set token={token} --set gatewayUrl={gw}"
            ),
        },
        "note": "The token is shown once. Store it in your secret manager.",
    }


@router.delete("/connectors/{connector_id}")
async def revoke_connector(
    connector_id: uuid.UUID, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    c = await s.get(Connector, connector_id)
    if c is None:
        raise HTTPException(404, "That connector doesn't exist.")
    name = c.name
    await s.delete(c)
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "connector.revoked",
        target_type="connector",
        target_id=str(connector_id),
        summary=f"revoked connector {name}",
    )
    await s.commit()
    await notify_gateway(connector_id)  # gateway drops the tunnel when auth no longer resolves
    return {"revoked": True}
