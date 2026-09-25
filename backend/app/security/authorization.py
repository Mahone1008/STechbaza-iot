import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.event_alarm import DeviceEvent
from app.models.organization import Organization
from app.models.site import Site
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.repositories.events import EventRepository
from app.repositories.memberships import MembershipRepository
from app.repositories.organizations import OrganizationRepository
from app.repositories.sites import SiteRepository
from app.security.current_user import CurrentUserContext
from app.security.roles import (
    Permission,
    PlatformRole,
    role_has_permission,
)


def _not_found() -> HTTPException:
    # Навмисно однаковий 404 для чужого tenant та реально відсутнього ресурсу.
    # Це не дозволяє перебирати UUID і визначати існування чужих ресурсів.
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Ресурс не знайдено",
    )


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостатньо прав для цієї дії",
    )


@dataclass(frozen=True)
class OrganizationAccessContext:
    """Результат authorization для Organization з role snapshot."""

    organization: Organization
    organization_role: str | None


@dataclass(frozen=True)
class DeviceAccessContext:
    """Результат authorization для Device з tenant context."""

    device: Device
    organization_id: uuid.UUID
    organization_role: str | None


class AccessControl:
    """Централізований RBAC + tenant-scope guard.

    Platform superadmin має повний bypass. Service admin не отримує
    автоматичний cross-tenant доступ: для tenant ресурсів йому потрібне
    explicit active membership, тому сервісний доступ можна видавати
    лише до потрібних клієнтів.
    """

    def __init__(
        self,
        session: Session,
        current: CurrentUserContext,
    ) -> None:
        self._session = session
        self._current = current
        self._organizations = OrganizationRepository(session)
        self._memberships = MembershipRepository(session)
        self._sites = SiteRepository(session)
        self._devices = DeviceRepository(session)
        self._events = EventRepository(session)
        self._commands = CommandRepository(session)

    @property
    def is_superadmin(self) -> bool:
        return self._current.user.platform_role == PlatformRole.SUPERADMIN.value

    @property
    def is_service_admin(self) -> bool:
        return (
            self._current.user.platform_role
            == PlatformRole.SERVICE_ADMIN.value
        )

    def require_platform_role(
        self,
        *roles: PlatformRole,
    ) -> None:
        allowed = {role.value for role in roles}
        if self._current.user.platform_role not in allowed:
            raise _forbidden()

    def list_visible_organizations(
        self,
        *,
        limit: int,
        offset: int,
    ) -> list[Organization]:
        if self.is_superadmin:
            return self._organizations.list(limit=limit, offset=offset)

        return self._organizations.list_for_user(
            self._current.user.id,
            limit=limit,
            offset=offset,
        )

    def require_organization_context(
        self,
        organization_id: uuid.UUID,
        permission: Permission,
    ) -> OrganizationAccessContext:
        organization = self._organizations.get(organization_id)
        if organization is None:
            raise _not_found()

        if self.is_superadmin:
            return OrganizationAccessContext(
                organization=organization,
                organization_role=None,
            )

        if not organization.is_active:
            raise _not_found()

        membership = self._memberships.get_active(
            self._current.user.id,
            organization_id,
        )
        if membership is None:
            raise _not_found()

        if not role_has_permission(membership.role, permission):
            raise _forbidden()

        return OrganizationAccessContext(
            organization=organization,
            organization_role=membership.role,
        )

    def require_organization(
        self,
        organization_id: uuid.UUID,
        permission: Permission,
    ) -> Organization:
        return self.require_organization_context(
            organization_id,
            permission,
        ).organization

    def require_site(
        self,
        site_id: uuid.UUID,
        permission: Permission,
    ) -> Site:
        site = self._sites.get(site_id)
        if site is None:
            raise _not_found()

        self.require_organization(site.organization_id, permission)
        return site

    def require_device_context(
        self,
        device_id: uuid.UUID,
        permission: Permission,
    ) -> DeviceAccessContext:
        device = self._devices.get(device_id)
        if device is None:
            raise _not_found()

        site = self._sites.get(device.site_id)
        if site is None:
            raise _not_found()

        organization_access = self.require_organization_context(
            site.organization_id,
            permission,
        )
        return DeviceAccessContext(
            device=device,
            organization_id=organization_access.organization.id,
            organization_role=organization_access.organization_role,
        )

    def require_device(
        self,
        device_id: uuid.UUID,
        permission: Permission,
    ) -> Device:
        return self.require_device_context(device_id, permission).device

    def require_command(
        self,
        command_id: uuid.UUID,
        permission: Permission,
    ) -> DeviceCommand:
        command = self._commands.get(command_id)
        if command is None:
            raise _not_found()

        self.require_device(command.device_id, permission)
        return command


    def require_event(
        self,
        event_id: uuid.UUID,
        permission: Permission,
    ) -> DeviceEvent:
        event = self._events.get(event_id)
        if event is None:
            raise _not_found()

        self.require_device(event.device_id, permission)
        return event
