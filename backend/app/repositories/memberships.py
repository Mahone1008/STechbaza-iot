import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.organization_membership import OrganizationMembership
from app.models.organization import Organization
from app.security.roles import OrganizationRole


class MembershipRepository:
    """SQL-операції для tenant memberships користувача."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def lock_organization(self, organization_id: uuid.UUID) -> uuid.UUID | None:
        """Усі зміни membership одного tenant виконуються послідовно."""

        return self._session.scalar(
            select(Organization.id)
            .where(Organization.id == organization_id)
            .with_for_update()
        )

    def get(
        self,
        membership_id: uuid.UUID,
    ) -> OrganizationMembership | None:
        statement = (
            select(OrganizationMembership)
            .options(selectinload(OrganizationMembership.user))
            .where(OrganizationMembership.id == membership_id)
        )
        return self._session.scalar(statement)

    def get_for_organization(
        self,
        membership_id: uuid.UUID,
        organization_id: uuid.UUID,
    ) -> OrganizationMembership | None:
        statement = (
            select(OrganizationMembership)
            .options(selectinload(OrganizationMembership.user))
            .where(
                OrganizationMembership.id == membership_id,
                OrganizationMembership.organization_id == organization_id,
            )
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    def get_for_user_organization(
        self,
        user_id: uuid.UUID,
        organization_id: uuid.UUID,
    ) -> OrganizationMembership | None:
        statement = select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
        )
        return self._session.scalar(statement)

    def get_active(
        self,
        user_id: uuid.UUID,
        organization_id: uuid.UUID,
    ) -> OrganizationMembership | None:
        statement = select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.is_active.is_(True),
        ).execution_options(populate_existing=True)
        return self._session.scalar(statement)

    def list_for_organization(
        self,
        organization_id: uuid.UUID,
    ) -> list[OrganizationMembership]:
        statement = (
            select(OrganizationMembership)
            .options(selectinload(OrganizationMembership.user))
            .where(
                OrganizationMembership.organization_id == organization_id,
            )
            .order_by(
                OrganizationMembership.is_active.desc(),
                OrganizationMembership.role.asc(),
                OrganizationMembership.created_at.asc(),
            )
        )
        return list(self._session.scalars(statement))

    def list_active_for_user(
        self,
        user_id: uuid.UUID,
    ) -> list[OrganizationMembership]:
        statement = (
            select(OrganizationMembership)
            .where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.is_active.is_(True),
            )
            .order_by(
                OrganizationMembership.organization_id.asc(),
                OrganizationMembership.created_at.asc(),
            )
        )
        return list(self._session.scalars(statement))

    def count_active_owners(
        self,
        organization_id: uuid.UUID,
    ) -> int:
        statement = select(func.count()).select_from(
            OrganizationMembership
        ).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.role == OrganizationRole.OWNER.value,
            OrganizationMembership.is_active.is_(True),
        )
        return int(self._session.scalar(statement) or 0)

    def add(
        self,
        membership: OrganizationMembership,
    ) -> OrganizationMembership:
        self._session.add(membership)
        self._session.flush()
        self._session.refresh(membership)
        return membership
