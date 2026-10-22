"""Background worker: claims jobs from Postgres and runs scans, executions and rollbacks.
Also schedules periodic scans for every organization with integrations."""

from __future__ import annotations

import asyncio
import os
import signal
import socket
import uuid
from datetime import timedelta

import structlog
from sqlalchemy import func, select

from martian.api.main import configure_logging
from martian.config import get_settings
from martian.db.base import system_session, utcnow
from martian.db.models import Integration, Job, Scan
from martian.jobs import queue
from martian.scans.scan import run_scan
from martian.services import findings
from martian.services.mcp import MCPBackend

log = structlog.get_logger()


async def handle(job: Job) -> None:
    org_id = job.org_id
    assert org_id is not None
    backend = MCPBackend(org_id)
    if job.kind == "scan":
        await run_scan(org_id, backend, trigger=job.payload.get("trigger", "schedule"))
    elif job.kind == "execute_finding":
        await findings.execute_finding(org_id, uuid.UUID(job.payload["finding_id"]), backend)
    elif job.kind == "rollback_action":
        error = await findings.rollback_action(
            org_id, uuid.UUID(job.payload["action_id"]), backend, reason="requested"
        )
        if error and error != "nothing to roll back":
            raise RuntimeError(error)
    else:
        raise ValueError(f"unknown job kind {job.kind}")


async def schedule_scans() -> int:
    """Enqueue a scan for each org whose last scan is older than the interval."""
    interval = timedelta(hours=get_settings().scan_interval_hours)
    queued = 0
    async with system_session() as s:
        orgs = [
            r[0]
            for r in (
                await s.execute(select(Integration.org_id).where(Integration.enabled.is_(True)).distinct())
            )
        ]
        for org_id in orgs:
            last = (
                await s.execute(select(func.max(Scan.started_at)).where(Scan.org_id == org_id))
            ).scalar_one()
            if last is None or last < utcnow() - interval:
                if await queue.enqueue(
                    s, "scan", {"trigger": "schedule"}, org_id=org_id, dedupe_key=f"scan:{org_id}"
                ):
                    queued += 1
    return queued


async def work_loop(worker_id: str, stop: asyncio.Event) -> None:
    poll = get_settings().worker_poll_seconds
    while not stop.is_set():
        job = await queue.claim(worker_id)
        if job is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll)
            except TimeoutError:
                pass
            continue
        structlog.contextvars.bind_contextvars(job_id=str(job.id), job_kind=job.kind)
        try:
            await handle(job)
            await queue.complete(job.id)
            log.info("job_done")
        except Exception as exc:  # noqa: BLE001
            log.exception("job_failed")
            await queue.fail(job, f"{type(exc).__name__}: {exc}")
        finally:
            structlog.contextvars.clear_contextvars()


async def scheduler_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            n = await schedule_scans()
            if n:
                log.info("scans_scheduled", count=n)
        except Exception:  # noqa: BLE001
            log.exception("scheduler_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            pass


async def main(concurrency: int = 4) -> None:
    configure_logging()
    get_settings().validate_for_production()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    base = f"{socket.gethostname()}-{os.getpid()}"
    log.info("worker_started", concurrency=concurrency)
    await asyncio.gather(scheduler_loop(stop), *(work_loop(f"{base}-{i}", stop) for i in range(concurrency)))


def run() -> None:
    asyncio.run(main(int(os.environ.get("MARTIAN_WORKER_CONCURRENCY", "4"))))
