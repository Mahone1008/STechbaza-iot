import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership


class OrganizationRepository:
    """Інкапсулює SQL-операції для організацій."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list(self, *, limit: int, offset: int) -> list[Organization]:
        statement = (
            select(Organization)
            .order_by(Organization.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[Organization]:
        statement = (
            select(Organization)
            .join(
                OrganizationMembership,
                OrganizationMembership.organization_id == Organization.id,
            )
            .where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.is_active.is_(True),
                Organization.is_active.is_(True),
            )
            .order_by(Organization.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def get(self, organization_id: uuid.UUID) -> Organization | None:
        return self._session.get(Organization, organization_id)

    def get_by_slug(self, slug: str) -> Organization | None:
        statement = select(Organization).where(Organization.slug == slug)
        return self._session.scalar(statement)

    def add(self, organization: Organization) -> Organization:
        self._session.add(organization)
        self._session.flush()
        self._session.refresh(organization)
        return organization
