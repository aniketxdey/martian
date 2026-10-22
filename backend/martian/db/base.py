"""Async SQLAlchemy engine and tenant-scoped sessions.

Every tenant table has a row-level-security policy keyed on the Postgres setting
`app.org_id`. `org_session()` sets it for the transaction, so a query that forgets
its `org_id` filter still cannot read another tenant's rows. System tasks that must
span tenants (connector auth, the scheduler, job claiming) use `system_session()`,
which sets `app.bypass_rls`.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from martian.config import get_settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        _engine = create_async_engine(
            get_settings().database_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


@asynccontextmanager
async def org_session(org_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """A transaction scoped to one tenant. Commits on success, rolls back on error."""
    async with get_sessionmaker()() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.org_id', :org, true)"), {"org": str(org_id)})
            yield session


@asynccontextmanager
async def system_session() -> AsyncIterator[AsyncSession]:
    """A transaction that may read across tenants. Use only for system tasks."""
    async with get_sessionmaker()() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))
            yield session
