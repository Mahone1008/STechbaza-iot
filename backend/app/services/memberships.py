import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.organization_membership import OrganizationMembership
from app.repositories.memberships import MembershipRepository
from app.repositories.users import UserRepository
from app.schemas.membership import MembershipCreate, MembershipUpdate
from app.security.roles import OrganizationRole, Permission, role_has_permission


class MembershipAlreadyExistsError(Exception):
    """Membership для цього User та Organization уже існує."""


class MembershipNotFoundError(Exception):
    """Membership не знайдено."""


class MembershipUserNotFoundError(Exception):
    """User не знайдений або вимкнений."""


class MembershipOwnerProtectedError(Exception):
    """Лише owner/superadmin може керувати owner membership."""


class MembershipLastOwnerError(Exception):
    """Не можна прибрати останнього активного owner."""


class MembershipPermissionError(Exception):
    """Доступ відкликано до отримання блокування організації."""


class MembershipService:
    """Бізнес-правила керування membership без privilege escalation."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._memberships = MembershipRepository(session)
        self._users = UserRepository(session)

    def list_for_organization(
        self,
        organization_id: uuid.UUID,
    ) -> list[OrganizationMembership]:
        return self._memberships.list_for_organization(organization_id)

    def _lock_and_authorize(
        self, organization_id: uuid.UUID, actor_user_id: uuid.UUID,
        actor_is_superadmin: bool,
    ) -> None:
        if self._memberships.lock_organization(organization_id) is None:
            raise MembershipNotFoundError
        if actor_is_superadmin:
            return
        actor = self._memberships.get_active(actor_user_id, organization_id)
        if actor is None or not role_has_permission(actor.role, Permission.MEMBERSHIP_MANAGE):
            raise MembershipPermissionError

    def _actor_is_owner(
        self,
        organization_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        *,
        actor_is_superadmin: bool,
    ) -> bool:
        if actor_is_superadmin:
            return True

        actor_membership = self._memberships.get_active(
            actor_user_id,
            organization_id,
        )
        return (
            actor_membership is not None
            and actor_membership.role == OrganizationRole.OWNER.value
        )

    def create(
        self,
        organization_id: uuid.UUID,
        payload: MembershipCreate,
        *,
        actor_user_id: uuid.UUID,
        actor_is_superadmin: bool,
    ) -> OrganizationMembership:
        self._lock_and_authorize(organization_id, actor_user_id, actor_is_superadmin)
        user = self._users.get(payload.user_id)
        if user is None or not user.is_active:
            raise MembershipUserNotFoundError

        if (
            payload.role == OrganizationRole.OWNER
            and not self._actor_is_owner(
                organization_id,
                actor_user_id,
                actor_is_superadmin=actor_is_superadmin,
            )
        ):
            raise MembershipOwnerProtectedError

        if (
            self._memberships.get_for_user_organization(
                payload.user_id,
                organization_id,
            )
            is not None
        ):
            raise MembershipAlreadyExistsError

        membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=payload.user_id,
            role=payload.role.value,
            is_active=True,
        )

        try:
            created = self._memberships.add(membership)
            self._session.commit()
            return self._memberships.get(created.id) or created
        except IntegrityError as exc:
            self._session.rollback()
            raise MembershipAlreadyExistsError from exc

    def update(
        self,
        organization_id: uuid.UUID,
        membership_id: uuid.UUID,
        payload: MembershipUpdate,
        *,
        actor_user_id: uuid.UUID,
        actor_is_superadmin: bool,
    ) -> OrganizationMembership:
        self._lock_and_authorize(organization_id, actor_user_id, actor_is_superadmin)
        membership = self._memberships.get_for_organization(
            membership_id,
            organization_id,
        )
        if membership is None:
            raise MembershipNotFoundError

        actor_is_owner = self._actor_is_owner(
            organization_id,
            actor_user_id,
            actor_is_superadmin=actor_is_superadmin,
        )

        target_is_owner = membership.role == OrganizationRole.OWNER.value
        wants_owner = payload.role == OrganizationRole.OWNER

        if (target_is_owner or wants_owner) and not actor_is_owner:
            raise MembershipOwnerProtectedError

        resulting_role = (
            payload.role.value
            if payload.role is not None
            else membership.role
        )
        resulting_active = (
            payload.is_active
            if payload.is_active is not None
            else membership.is_active
        )

        removes_active_owner = (
            membership.role == OrganizationRole.OWNER.value
            and membership.is_active
            and (
                resulting_role != OrganizationRole.OWNER.value
                or not resulting_active
            )
        )
        if (
            removes_active_owner
            and self._memberships.count_active_owners(organization_id) <= 1
        ):
            raise MembershipLastOwnerError

        membership.role = resulting_role
        membership.is_active = resulting_active

        self._session.commit()
        self._session.refresh(membership)
        return self._memberships.get(membership.id) or membership
