"""Ask Martian: threads, streaming turns (SSE) and approval resumes."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.agents.chat import encode_sse, ensure_thread_title, run_turn, thread_view
from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.db.base import org_session
from martian.db.models import ChatThread, Role

router = APIRouter(prefix="/chat", tags=["chat"])


async def _own_thread(p: Principal, thread_id: uuid.UUID) -> ChatThread:
    async with org_session(p.org_id) as s:
        t = await s.get(ChatThread, thread_id)
    if t is None or (t.user_id != p.user_id and not p.at_least(Role.admin)):
        raise HTTPException(404, "conversation not found")
    return t


@router.get("/threads")
async def list_threads(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = (
        await s.execute(
            select(ChatThread)
            .where(ChatThread.org_id == p.org_id, ChatThread.user_id == p.user_id)
            .order_by(ChatThread.updated_at.desc())
            .limit(50)
        )
    ).scalars()
    return {
        "threads": [{"id": str(t.id), "title": t.title, "updated_at": t.updated_at.isoformat()} for t in rows]
    }


@router.post("/threads", status_code=201)
async def create_thread(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    t = ChatThread(org_id=p.org_id, user_id=p.user_id)
    s.add(t)
    await s.flush()
    return {"id": str(t.id), "title": t.title}


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: uuid.UUID, p: Principal = Depends(current_principal)) -> dict:
    t = await _own_thread(p, thread_id)
    return {"id": str(t.id), "title": t.title, **(await thread_view(p.org_id, thread_id))}


class MessageBody(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class ResumeBody(BaseModel):
    approved: bool
    comment: str | None = None


def _stream(events: AsyncIterator[dict]) -> StreamingResponse:
    async def body() -> AsyncIterator[bytes]:
        async for e in events:
            yield encode_sse(e)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/threads/{thread_id}/messages")
async def send_message(thread_id: uuid.UUID, body: MessageBody, p: Principal = Depends(current_principal)):
    await _own_thread(p, thread_id)
    await ensure_thread_title(p.org_id, thread_id, body.content)
    return _stream(run_turn(p.org_id, thread_id, p.as_dict(), message=body.content))


@router.post("/threads/{thread_id}/resume")
async def resume(thread_id: uuid.UUID, body: ResumeBody, p: Principal = Depends(require(Role.approver))):
    await _own_thread(p, thread_id)
    view = await thread_view(p.org_id, thread_id)
    if not view["pending_approval"]:
        raise HTTPException(409, "nothing is waiting for approval")
    return _stream(run_turn(p.org_id, thread_id, p.as_dict(), resume=body.model_dump()))
