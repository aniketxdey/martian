"""A small, durable job queue on Postgres (FOR UPDATE SKIP LOCKED)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from martian.db.base import system_session, utcnow
from martian.db.models import Job

STALE_LOCK = timedelta(minutes=15)


async def enqueue(
    session: AsyncSession,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    org_id: uuid.UUID | None = None,
    run_at: datetime | None = None,
    dedupe_key: str | None = None,
    max_attempts: int = 3,
) -> Job | None:
    """Queue a job. With `dedupe_key`, skips if an unfinished job with that key exists."""
    if dedupe_key:
        existing = (
            await session.execute(
                select(Job.id).where(Job.dedupe_key == dedupe_key, Job.status.in_(["queued", "running"]))
            )
        ).first()
        if existing:
            return None
    job = Job(
        kind=kind,
        payload=payload or {},
        org_id=org_id,
        run_at=run_at or utcnow(),
        dedupe_key=dedupe_key,
        max_attempts=max_attempts,
    )
    session.add(job)
    await session.flush()
    return job


async def claim(worker_id: str) -> Job | None:
    """Atomically claim the next runnable job (or one whose worker died)."""
    now = utcnow()
    async with system_session() as session:
        job = (
            await session.execute(
                select(Job)
                .where(
                    or_(
                        and_(Job.status == "queued", Job.run_at <= now),
                        and_(Job.status == "running", Job.locked_at < now - STALE_LOCK),
                    )
                )
                .order_by(Job.run_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if job is None:
            return None
        job.status = "running"
        job.locked_at = now
        job.locked_by = worker_id
        job.attempts += 1
        return job


async def complete(job_id: uuid.UUID) -> None:
    async with system_session() as session:
        await session.execute(
            update(Job).where(Job.id == job_id).values(status="done", finished_at=utcnow(), locked_by=None)
        )


async def fail(job: Job, error: str) -> None:
    """Retry with exponential backoff, or mark failed after max_attempts."""
    async with system_session() as session:
        if job.attempts >= job.max_attempts:
            values: dict[str, Any] = {"status": "failed", "finished_at": utcnow()}
        else:
            values = {
                "status": "queued",
                "run_at": utcnow() + timedelta(seconds=30 * 2 ** (job.attempts - 1)),
            }
        await session.execute(
            update(Job).where(Job.id == job.id).values(last_error=error[:4000], locked_by=None, **values)
        )
