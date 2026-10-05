import uuid

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.models.site import Site
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.security.tokens import utc_now


class SiteRepository:
    """Інкапсулює SQL-операції для фізичних об'єктів."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_organization(
        self,
        organization_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        allowed_site_ids: list[uuid.UUID] | None = None,
    ) -> list[Site]:
        statement = (
            select(Site)
            .where(Site.organization_id == organization_id)
            .order_by(Site.created_at.desc(), Site.id.desc())
            .limit(limit)
            .offset(offset)
        )
        if allowed_site_ids is not None:
            statement = statement.where(Site.id.in_(allowed_site_ids))
        return list(self._session.scalars(statement))

    def get(self, site_id: uuid.UUID) -> Site | None:
        return self._session.get(Site, site_id)

    def list_for_user_permission(
        self,
        user_id: uuid.UUID,
        roles: list[str],
        *,
        superadmin: bool,
        limit: int,
        offset: int,
    ) -> list[Site]:
        statement = select(Site)
        if not superadmin:
            scope = cast(OrganizationMembership.site_ids, JSONB)
            statement = (
                statement.join(Organization)
                .join(
                    OrganizationMembership,
                    OrganizationMembership.organization_id == Organization.id,
                )
                .where(
                    Organization.is_active.is_(True),
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.is_active.is_(True),
                    OrganizationMembership.role.in_(roles),
                    or_(
                        OrganizationMembership.expires_at.is_(None),
                        OrganizationMembership.expires_at > utc_now(),
                    ),
                    or_(
                        OrganizationMembership.site_ids.is_(None),
                        func.jsonb_typeof(scope) == "null",
                        scope.contains(func.jsonb_build_array(cast(Site.id, String))),
                    ),
                )
            )
        # Permission/scope filtering must precede pagination, across every tenant.
        return list(
            self._session.scalars(
                statement.order_by(Site.name, Site.id).limit(limit).offset(offset)
            )
        )

    def get_by_code(
        self,
        organization_id: uuid.UUID,
        code: str,
    ) -> Site | None:
        statement = select(Site).where(
            Site.organization_id == organization_id,
            Site.code == code,
        )
        return self._session.scalar(statement)

    def add(self, site: Site) -> Site:
        self._session.add(site)
        self._session.flush()
        self._session.refresh(site)
        return site
