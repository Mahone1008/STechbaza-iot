import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization_membership import OrganizationMembership


class MembershipRepository:
    """SQL-операції для tenant memberships користувача."""

    def __init__(self, session: Session) -> None:
        self._session = session

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
