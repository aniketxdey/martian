"""Alembic environment. Migrations run as the table owner (MARTIAN_MIGRATION_DATABASE_URL)."""

from alembic import context
from sqlalchemy import create_engine, pool

from martian.config import get_settings
from martian.db import models  # noqa: F401  (registers tables)
from martian.db.base import Base

target_metadata = Base.metadata


def _url() -> str:
    s = get_settings()
    return s.migration_database_url or s.database_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
