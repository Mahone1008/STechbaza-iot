import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.repositories.organizations import OrganizationRepository
from app.schemas.organization import OrganizationCreate


class OrganizationAlreadyExistsError(Exception):
    """Організація з таким slug уже існує."""


class OrganizationNotFoundError(Exception):
    """Організацію не знайдено."""


class OrganizationService:
    """Бізнес-логіка роботи з організаціями."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repository = OrganizationRepository(session)

    def list(self, *, limit: int, offset: int) -> list[Organization]:
        return self._repository.list(limit=limit, offset=offset)

    def get(self, organization_id: uuid.UUID) -> Organization:
        organization = self._repository.get(organization_id)
        if organization is None:
            raise OrganizationNotFoundError
        return organization

    def create(self, payload: OrganizationCreate) -> Organization:
        # Перевірка до INSERT дає зрозумілу бізнес-помилку, а unique constraint
        # у PostgreSQL залишається фінальним захистом від race condition.
        if self._repository.get_by_slug(payload.slug) is not None:
            raise OrganizationAlreadyExistsError

        organization = Organization(
            name=payload.name.strip(),
            slug=payload.slug,
        )

        try:
            created = self._repository.add(organization)
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise OrganizationAlreadyExistsError from exc

        return created
