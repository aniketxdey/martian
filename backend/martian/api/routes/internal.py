"""Service-to-service endpoints used by the gateway (internal token required)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from martian.api.deps import require_internal
from martian.db.base import org_session, system_session, utcnow
from martian.db.models import Connector, Integration
from martian.security.auth import hash_token
from martian.security.crypto import decrypt_json
from martian.services import audit
from martian.services.integrations import connector_config

router = APIRouter(
    prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal)], include_in_schema=False
)


class ConnectorAuth(BaseModel):
    token: str
    version: str | None = None


@router.post("/connectors/auth")
async def connector_auth(body: ConnectorAuth) -> dict:
    async with system_session() as s:
        c = (
            await s.execute(select(Connector).where(Connector.token_hash == hash_token(body.token)))
        ).scalar_one_or_none()
        if c is None:
            raise HTTPException(401, "unknown connector token")
        c.version = body.version
        return {
            "connector_id": str(c.id),
            "org_id": str(c.org_id),
            "sandbox": c.sandbox,
            "integrations": await connector_config(s, c),
        }


@router.get("/connectors/{connector_id}/config")
async def config(connector_id: uuid.UUID) -> dict:
    async with system_session() as s:
        c = await s.get(Connector, connector_id)
        if c is None:
            raise HTTPException(404, "That connector was revoked.")
        return {
            "connector_id": str(c.id),
            "org_id": str(c.org_id),
            "sandbox": c.sandbox,
            "integrations": await connector_config(s, c),
        }


class StatusBody(BaseModel):
    status: Literal["online", "offline"]


@router.post("/connectors/{connector_id}/status")
async def status(connector_id: uuid.UUID, body: StatusBody) -> dict:
    async with system_session() as s:
        c = await s.get(Connector, connector_id)
        if c is None:
            raise HTTPException(404, "That connector was revoked.")
        changed = c.status != body.status
        c.status = body.status
        c.last_seen_at = utcnow()
        org_id, name = c.org_id, c.name
    if changed:
        async with org_session(org_id) as s:
            await audit.record(
                s,
                org_id,
                audit.Actor("connector", str(connector_id), name),
                f"connector.{body.status}",
                target_type="connector",
                target_id=str(connector_id),
                summary=f"connector {name} is {body.status}",
            )
    return {"ok": True}


@router.get("/integrations/{integration_id}/route")
async def route(integration_id: uuid.UUID) -> dict:
    async with system_session() as s:
        i = await s.get(Integration, integration_id)
        if i is None or not i.enabled:
            raise HTTPException(404, "That integration doesn't exist or is turned off.")
        if i.kind == "custom" and (i.config or {}).get("transport") != "stdio":
            secrets = decrypt_json(i.secrets_ciphertext)
            headers = {"Authorization": secrets["authorization"]} if secrets.get("authorization") else {}
            return {
                "type": "http",
                "org_id": str(i.org_id),
                "url": (i.config or {}).get("url"),
                "headers": headers,
            }
        if i.connector_id is None:
            raise HTTPException(409, "This integration isn't attached to a connector yet.")
        return {"type": "connector", "org_id": str(i.org_id), "connector_id": str(i.connector_id)}
