import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.site import Site
from app.repositories.organizations import OrganizationRepository
from app.repositories.sites import SiteRepository
from app.schemas.site import SiteCreate


class SiteAlreadyExistsError(Exception):
    """Об'єкт з таким code вже існує в цій організації."""


class SiteNotFoundError(Exception):
    """Об'єкт не знайдено."""


class ParentOrganizationNotFoundError(Exception):
    """Батьківську організацію не знайдено."""


class SiteService:
    """Бізнес-логіка роботи з фізичними об'єктами."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._sites = SiteRepository(session)
        self._organizations = OrganizationRepository(session)

    def list_for_organization(
        self,
        organization_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[Site]:
        if self._organizations.get(organization_id) is None:
            raise ParentOrganizationNotFoundError

        return self._sites.list_for_organization(
            organization_id,
            limit=limit,
            offset=offset,
        )

    def get(self, site_id: uuid.UUID) -> Site:
        site = self._sites.get(site_id)
        if site is None:
            raise SiteNotFoundError
        return site

    def create(
        self,
        organization_id: uuid.UUID,
        payload: SiteCreate,
    ) -> Site:
        if self._organizations.get(organization_id) is None:
            raise ParentOrganizationNotFoundError

        # code унікальний у межах однієї організації. Це дозволяє різним
        # клієнтам використовувати однакові локальні назви об'єктів.
        if self._sites.get_by_code(organization_id, payload.code) is not None:
            raise SiteAlreadyExistsError

        site = Site(
            organization_id=organization_id,
            name=payload.name.strip(),
            code=payload.code,
            timezone=payload.timezone,
        )

        try:
            created = self._sites.add(site)
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise SiteAlreadyExistsError from exc

        return created
