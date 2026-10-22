"""On-premises servers reached over SSH through the customer's connector."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.db.base import org_session
from martian.db.models import Connector, Integration, Role, Server
from martian.security.crypto import encrypt
from martian.services import audit
from martian.services.integrations import notify_gateway
from martian.services.mcp import MCPBackend

router = APIRouter(prefix="/servers", tags=["servers"])


def _server(sv: Server) -> dict:
    return {
        "id": str(sv.id),
        "name": sv.name,
        "os": sv.os,
        "ipAddress": sv.ip_address,
        "username": sv.username,
        "description": sv.description,
        "status": sv.status,
        "hasPassword": bool(sv.password_ciphertext),
        "lastError": sv.last_error,
    }


async def _ssh_integration(s: AsyncSession, org_id: uuid.UUID) -> Integration:
    i = (
        (await s.execute(select(Integration).where(Integration.org_id == org_id, Integration.kind == "ssh")))
        .scalars()
        .first()
    )
    if i is None:
        connector = (
            (
                await s.execute(
                    select(Connector).where(Connector.org_id == org_id).order_by(Connector.created_at)
                )
            )
            .scalars()
            .first()
        )
        if connector is None:
            raise HTTPException(
                400, "create a connector first; it reaches your servers from inside your network"
            )
        i = Integration(
            org_id=org_id, kind="ssh", name="Physical servers", connector_id=connector.id, status="pending"
        )
        s.add(i)
        await s.flush()
    return i


@router.get("")
async def list_servers(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = (
        await s.execute(select(Server).where(Server.org_id == p.org_id).order_by(Server.created_at))
    ).scalars()
    return {"servers": [_server(sv) for sv in rows]}


class ServerBody(BaseModel):
    name: str | None = None
    os: str | None = None
    ipAddress: str | None = None
    username: str | None = None
    description: str | None = None
    password: str | None = None


@router.post("", status_code=201)
async def create_server(
    body: ServerBody, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    integration = await _ssh_integration(s, p.org_id)
    count = len(list((await s.execute(select(Server.id).where(Server.org_id == p.org_id))).all()))
    sv = Server(
        org_id=p.org_id,
        integration_id=integration.id,
        name=body.name or f"Server {count + 1}",
        os=body.os or "Ubuntu 22.04 LTS",
        ip_address=body.ipAddress or "",
        username=body.username or "admin",
        description=body.description or "",
        password_ciphertext=encrypt(body.password) if body.password else None,
    )
    s.add(sv)
    await s.flush()
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "server.created",
        target_type="server",
        target_id=str(sv.id),
        summary=f"added server {sv.name}",
    )
    out, connector_id = _server(sv), integration.connector_id
    await s.commit()
    await notify_gateway(connector_id)
    return out


@router.patch("/{server_id}")
async def update_server(
    server_id: uuid.UUID,
    body: ServerBody,
    p: Principal = Depends(require(Role.admin)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    sv = await s.get(Server, server_id)
    if sv is None:
        raise HTTPException(404, "server not found")
    for field, col in [
        ("name", "name"),
        ("os", "os"),
        ("ipAddress", "ip_address"),
        ("username", "username"),
        ("description", "description"),
    ]:
        v = getattr(body, field)
        if v is not None:
            setattr(sv, col, v)
    if body.password is not None:
        sv.password_ciphertext = encrypt(body.password) if body.password else None
    sv.status = "disconnected" if sv.status == "error" else sv.status
    integration = await s.get(Integration, sv.integration_id) if sv.integration_id else None
    out = _server(sv)
    await s.commit()
    await notify_gateway(integration.connector_id if integration else None)
    return out


@router.delete("/{server_id}")
async def delete_server(
    server_id: uuid.UUID, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    sv = await s.get(Server, server_id)
    if sv is None:
        raise HTTPException(404, "server not found")
    name = sv.name
    await s.delete(sv)
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "server.deleted",
        target_type="server",
        target_id=str(server_id),
        summary=f"removed server {name}",
    )
    return {"deleted": True}


@router.post("/{server_id}/connect")
async def connect(server_id: uuid.UUID, p: Principal = Depends(require(Role.admin))) -> dict:
    async with org_session(p.org_id) as s:
        sv = await s.get(Server, server_id)
        if sv is None:
            raise HTTPException(404, "server not found")
        if not sv.ip_address or not sv.password_ciphertext:
            raise HTTPException(400, "add an IP address and password first")
        sv.status = "connecting"
        integration_id = sv.integration_id
    try:
        result = await MCPBackend(p.org_id, timeout=30).call_tool(
            str(integration_id), "ssh_check_host", {"host_id": str(server_id)}
        )
        ok = bool(result.get("ok")) if isinstance(result, dict) else False
        error = None if ok else (result.get("error") if isinstance(result, dict) else "connection failed")
    except Exception as exc:  # noqa: BLE001
        ok, error = False, str(exc)
    async with org_session(p.org_id) as s:
        sv = await s.get(Server, server_id)
        assert sv is not None
        sv.status = "connected" if ok else "error"
        sv.last_error = error
        await audit.record(
            s,
            p.org_id,
            p.actor,
            "server.connected" if ok else "server.connect_failed",
            target_type="server",
            target_id=str(server_id),
            summary=f"{'connected to' if ok else 'could not connect to'} {sv.name}",
        )
        return _server(sv)


@router.get("/{server_id}/files")
async def list_files(
    server_id: uuid.UUID, path: str = "/home", p: Principal = Depends(require(Role.admin))
) -> dict:
    async with org_session(p.org_id) as s:
        sv = await s.get(Server, server_id)
        if sv is None:
            raise HTTPException(404, "server not found")
        if sv.status != "connected":
            raise HTTPException(409, "connect to the server first")
        integration_id = sv.integration_id
    result = await MCPBackend(p.org_id, timeout=30).call_tool(
        str(integration_id), "ssh_list_dir", {"host_id": str(server_id), "path": path}
    )
    return result if isinstance(result, dict) else {"path": path, "files": []}
