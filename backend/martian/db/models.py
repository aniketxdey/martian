from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from martian.db.base import Base, utcnow


def uid() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def org_fk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True)


def ts(nullable: bool = False) -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=None if nullable else utcnow, nullable=nullable)


class Role(enum.StrEnum):
    owner = "owner"
    admin = "admin"
    approver = "approver"
    viewer = "viewer"

    @property
    def rank(self) -> int:
        return {"viewer": 0, "approver": 1, "admin": 2, "owner": 3}[self.value]


class PermissionMode(enum.StrEnum):
    read = "read"  # agents may only call read tools
    ask = "ask"  # write tools need a person's approval
    auto = "auto"  # low-risk writes under the org's threshold run automatically


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = uid()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    email_domain: Mapped[str | None] = mapped_column(String(200), unique=True)
    workos_org_id: Mapped[str | None] = mapped_column(String(100))
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uid()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()
    last_login_at: Mapped[datetime | None] = ts(nullable=True)


class Membership(Base):
    __tablename__ = "memberships"
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(20), default=Role.viewer.value)
    created_at: Mapped[datetime] = ts()


class Connector(Base):
    """A customer-side process that hosts MCP servers and dials out to the gateway."""

    __tablename__ = "connectors"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    name: Mapped[str] = mapped_column(String(200))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    token_prefix: Mapped[str] = mapped_column(String(16))
    hosted: Mapped[bool] = mapped_column(Boolean, default=False)
    sandbox: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|online|offline
    version: Mapped[str | None] = mapped_column(String(40))
    last_seen_at: Mapped[datetime | None] = ts(nullable=True)
    created_at: Mapped[datetime] = ts()


class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    kind: Mapped[str] = mapped_column(String(40))  # aws|azure|gcp|vcenter|ssh|custom
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|connected|auth|error
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    mode: Mapped[str] = mapped_column(String(10), default=PermissionMode.ask.value)
    connector_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("connectors.id", ondelete="SET NULL")
    )
    # Non-secret configuration (accounts, regions, role ARNs, subscription ids, URLs).
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Encrypted secrets (only for integrations whose credentials are entered in the UI).
    secrets_ciphertext: Mapped[str | None] = mapped_column(Text)
    # Tool catalog last reported by the MCP server: [{name, description, write}].
    tools: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    disabled_tools: Mapped[list[str]] = mapped_column(JSONB, default=list)
    last_sync_at: Mapped[datetime | None] = ts(nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()


class Server(Base):
    """An on-premises machine reachable over SSH/RDP through the connector."""

    __tablename__ = "servers"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    integration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(200))
    os: Mapped[str] = mapped_column(String(80), default="Ubuntu 22.04 LTS")
    ip_address: Mapped[str] = mapped_column(String(100), default="")
    username: Mapped[str] = mapped_column(String(100), default="admin")
    description: Mapped[str] = mapped_column(Text, default="")
    password_ciphertext: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="disconnected")
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()


class Resource(Base):
    """Normalized inventory item from any provider."""

    __tablename__ = "resources"
    __table_args__ = (UniqueConstraint("org_id", "integration_id", "resource_id"),)
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(20))
    account: Mapped[str] = mapped_column(String(200), default="")
    region: Mapped[str] = mapped_column(String(80), default="")
    resource_type: Mapped[str] = mapped_column(
        String(60)
    )  # vm|volume|snapshot|database|load_balancer|asg|host|datastore
    resource_id: Mapped[str] = mapped_column(String(400))
    name: Mapped[str] = mapped_column(String(400), default="")
    state: Mapped[str] = mapped_column(String(60), default="")
    environment: Mapped[str] = mapped_column(String(20), default="cloud")  # cloud|dc|labs|edge
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    tags: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    monthly_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    first_seen_at: Mapped[datetime] = ts()
    last_seen_at: Mapped[datetime] = ts()


class Scan(Base):
    __tablename__ = "scans"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|succeeded|partial|failed
    trigger: Mapped[str] = mapped_column(String(20), default="schedule")
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = ts()
    finished_at: Mapped[datetime | None] = ts(nullable=True)


class Finding(Base):
    __tablename__ = "findings"
    __table_args__ = (UniqueConstraint("org_id", "fingerprint"),)
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    fingerprint: Mapped[str] = mapped_column(String(128))
    integration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="SET NULL")
    )
    rule: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(40))  # compute|storage|database|network|scaling|data
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(String(200), default="")
    affects: Mapped[str] = mapped_column(String(100), default="")
    resource_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    est_monthly_savings: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    realized_monthly_savings: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal(0))
    effort: Mapped[str] = mapped_column(String(10), default="easy")  # easy|medium
    risk: Mapped[str] = mapped_column(String(10), default="low")  # low|medium|high
    time_to_apply: Mapped[str] = mapped_column(String(40), default="< 5 minutes")
    status: Mapped[str] = mapped_column(String(20), default="open")
    # [{integration_id, tool, args, rollback: {tool, args} | None, description}]
    plan: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    steps: Mapped[list[str]] = mapped_column(JSONB, default=list)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    first_seen_at: Mapped[datetime] = ts()
    last_seen_at: Mapped[datetime] = ts()
    resolved_at: Mapped[datetime | None] = ts(nullable=True)


class Action(Base):
    """One write tool call: proposed, approved, executed and (if possible) reversible."""

    __tablename__ = "actions"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    finding_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("findings.id", ondelete="SET NULL"), index=True
    )
    thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE")
    )
    tool: Mapped[str] = mapped_column(String(120))
    args: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    requested_by: Mapped[str] = mapped_column(String(100), default="agent")
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = ts(nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    rollback: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = ts()
    finished_at: Mapped[datetime | None] = ts(nullable=True)


class ChatThread(Base):
    __tablename__ = "chat_threads"
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID] = org_fk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(300), default="New conversation")
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = ts()


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claim", "status", "run_at"),)
    id: Mapped[uuid.UUID] = uid()
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    dedupe_key: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|done|failed
    run_at: Mapped[datetime] = ts()
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    last_error: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = ts(nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = ts()
    finished_at: Mapped[datetime | None] = ts(nullable=True)


class AuditEntry(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    org_id: Mapped[uuid.UUID] = org_fk()
    at: Mapped[datetime] = ts()
    actor_type: Mapped[str] = mapped_column(String(20))  # user|agent|system|connector
    actor_id: Mapped[str] = mapped_column(String(100), default="")
    actor_label: Mapped[str] = mapped_column(String(320), default="")
    action: Mapped[str] = mapped_column(String(100))
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(200), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")


# Tables protected by row-level security (all tenant data).
TENANT_TABLES = [
    "connectors",
    "integrations",
    "servers",
    "resources",
    "scans",
    "findings",
    "actions",
    "chat_threads",
    "audit_log",
]
