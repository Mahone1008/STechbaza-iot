from __future__ import annotations

import uuid
from app.security.tokens import utc_now

from sqlalchemy import cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
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
            .order_by(Organization.created_at.desc(), Organization.id.desc())
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
                or_(
                    OrganizationMembership.expires_at.is_(None),
                    OrganizationMembership.expires_at > utc_now(),
                ),
                Organization.is_active.is_(True),
            )
            .order_by(Organization.created_at.desc(), Organization.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def get(self, organization_id: uuid.UUID) -> Organization | None:
        return self._session.get(Organization, organization_id)

    def list_for_user_permission(
        self, user_id: uuid.UUID, roles: list[str], *, superadmin: bool, limit: int, offset: int
    ):
        query = select(Organization).where(Organization.is_active.is_(True))
        if not superadmin:
            query = query.join(OrganizationMembership).where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.is_active.is_(True),
                OrganizationMembership.role.in_(roles),
                or_(
                    OrganizationMembership.site_ids.is_(None),
                    func.jsonb_typeof(cast(OrganizationMembership.site_ids, JSONB)) == "null",
                ),
                or_(
                    OrganizationMembership.expires_at.is_(None),
                    OrganizationMembership.expires_at > utc_now(),
                ),
            )
        return list(
            self._session.scalars(
                query.order_by(Organization.name, Organization.id).limit(limit).offset(offset)
            )
        )

    def get_by_slug(self, slug: str) -> Organization | None:
        statement = select(Organization).where(Organization.slug == slug)
        return self._session.scalar(statement)

    def add(self, organization: Organization) -> Organization:
        self._session.add(organization)
        self._session.flush()
        self._session.refresh(organization)
        return organization
