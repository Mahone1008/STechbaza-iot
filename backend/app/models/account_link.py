"""Expiring, single-use email proofs; only token digests are stored."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.mixins import TimestampMixin


class AccountLink(TimestampMixin, Base):
    __tablename__ = "account_links"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('registration', 'invitation')", name="ck_account_link_purpose"
        ),
        CheckConstraint(
            "(purpose = 'registration' AND organization_id IS NULL AND role IS NULL) OR "
            "(purpose = 'invitation' AND organization_id IS NOT NULL AND role IS NOT NULL)",
            name="ck_account_link_context",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str | None] = mapped_column(String(32))
    site_ids: Mapped[list[str] | None] = mapped_column(JSON)
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    controller_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("factory_controllers.id", ondelete="CASCADE")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
