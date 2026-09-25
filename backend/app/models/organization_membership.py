import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.mixins import TimestampMixin
from app.security.roles import ORGANIZATION_ROLE_VALUES

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class OrganizationMembership(TimestampMixin, Base):
    """Прив'язка User до tenant-організації з локальною RBAC-роллю."""

    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_organization_memberships_organization_user",
        ),
        CheckConstraint(
            f"role IN {ORGANIZATION_ROLE_VALUES}",
            name="ck_organization_memberships_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="viewer",
        server_default="viewer",
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    organization: Mapped["Organization"] = relationship(
        back_populates="memberships",
    )
    user: Mapped["User"] = relationship(
        back_populates="memberships",
    )
