import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.site import Site


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
    ) -> list[Site]:
        statement = (
            select(Site)
            .where(Site.organization_id == organization_id)
            .order_by(Site.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def get(self, site_id: uuid.UUID) -> Site | None:
        return self._session.get(Site, site_id)

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
