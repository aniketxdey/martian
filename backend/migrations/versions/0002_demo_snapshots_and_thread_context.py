"""demo snapshots and chat thread context

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-26 17:30:00
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column(
            "context",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_table(
        "demo_snapshots",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("org_id"),
    )
    # Same tenant isolation as every other tenant table (see 0001).
    op.execute("ALTER TABLE demo_snapshots ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE demo_snapshots FORCE ROW LEVEL SECURITY")
    op.execute(
        """CREATE POLICY tenant_isolation ON demo_snapshots
            USING (
                current_setting('app.bypass_rls', true) = 'on'
                OR org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
            )"""
    )
    op.execute(
        """DO $$
           BEGIN
             IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'martian_app') THEN
               GRANT SELECT, INSERT, UPDATE, DELETE ON demo_snapshots TO martian_app;
             END IF;
           END $$"""
    )


def downgrade() -> None:
    op.drop_table("demo_snapshots")
    op.drop_column("chat_threads", "context")
