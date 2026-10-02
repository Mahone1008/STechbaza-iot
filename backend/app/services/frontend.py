"""Збирає read model з наявних джерел істини без записів у БД."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.device_contract import COMMAND_REQUIRED_CAPABILITY, selected_channels
from app.repositories.capabilities import CapabilityRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.availability import DeviceAvailabilityRead
from app.schemas.capability import CapabilityRead
from app.schemas.device import DeviceRead
from app.schemas.frontend import (
    DeviceModuleRead, DeviceOverviewRead, OrganizationAccessRead, TelemetryChannelRead,
)
from app.schemas.telemetry import DeviceStateRead
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission, role_has_permission
from app.services.command_profile import configured_limits
from app.services.equipment import configuration_state, configuration_target, desired_configuration
from app.services.device_presence import DevicePresenceService
from app.services.telemetry_quality import freshness, readings, state_readings, json_safe


class OverviewPermissionError(Exception):
    """Агрегат не повинен обходити права окремих джерел даних."""


class FrontendReadService:
    def __init__(self, session: Session, current: CurrentUserContext) -> None:
        self._session = session
        self._current = current
        self._access = AccessControl(session, current)

    def _access_snapshot(
        self, organization_id: uuid.UUID, role: str | None,
    ) -> OrganizationAccessRead:
        # Та сама таблиця прав, яку використовують серверні authorization guards.
        permissions = [
            permission for permission in Permission
            if self._access.is_superadmin
            or (role is not None and role_has_permission(role, permission))
        ]
        return OrganizationAccessRead(
            organization_id=organization_id,
            platform_role=self._current.user.platform_role,
            organization_role=role,
            permissions=sorted(permissions),
        )

    def organization_access(self, organization_id: uuid.UUID) -> OrganizationAccessRead:
        context = self._access.require_organization_context(
            organization_id, Permission.ORGANIZATION_READ,
        )
        return self._access_snapshot(context.organization.id, context.organization_role)

    def device_overview(self, device_id: uuid.UUID) -> DeviceOverviewRead:
        context = self._access.require_device_context(device_id, Permission.DEVICE_READ)
        access = self._access_snapshot(context.organization_id, context.organization_role)
        if not {Permission.CAPABILITY_READ, Permission.TELEMETRY_READ}.issubset(access.permissions):
            raise OverviewPermissionError

        assignments = CapabilityRepository(self._session).get_enabled_assignments_for_device(device_id)
        capabilities = sorted(
            (CapabilityRead.model_validate(item.capability) for item in assignments),
            key=lambda item: item.code,
        )
        can_execute = Permission.COMMAND_EXECUTE in access.permissions
        modules = []
        for assignment in sorted(assignments, key=lambda item: item.capability.code):
            code = assignment.capability.code
            channel_definitions = sorted(selected_channels(code, assignment.config), key=lambda item: (item.source, item.key))
            channels = [TelemetryChannelRead(
                key=channel.key, source=channel.source, data_type=channel.data_type,
                unit=channel.unit, supports_series=channel.supports_series,
            ) for channel in channel_definitions
                if channel.capability_code == code]
            commands = sorted(key for key, required in COMMAND_REQUIRED_CAPABILITY.items() if required == code)
            modules.append(DeviceModuleRead(
                assignment_id=assignment.id, capability_id=assignment.capability_id, code=code,
                supported=bool(channels or commands), channels=channels, command_types=commands,
                allowed_commands=commands if can_execute else [],
            ))
        channels = [channel for module in modules for channel in module.channels]
        value_keys = sorted(channel.key for channel in channels if channel.source == "values")
        state_keys = sorted(channel.key for channel in channels if channel.source == "state")
        command_types = sorted(command for module in modules for command in module.command_types)

        stored = TelemetryRepository(self._session).get_state(device_id)
        snapshot = DeviceStateRead.model_validate(stored) if stored is not None else None
        if snapshot is not None:
            # Старі показники вимкненого модуля не повертають віджет на екран.
            # Фільтруємо DTO, не змінюємо збережений snapshot або історію.
            snapshot = snapshot.model_copy(update={
                "values": {key: value for key, value in snapshot.values.items() if key in value_keys},
                "state": {key: value for key, value in snapshot.state.items() if key in state_keys},
            })

        generated_at = datetime.now(timezone.utc)
        equipment_configuration = desired_configuration(self._session, device_id)
        equipment_state = configuration_state(context.device, equipment_configuration, stored, generated_at)
        if equipment_state not in {"legacy", "verified"}:
            for module in modules:
                module.allowed_commands = [command for command in module.allowed_commands
                                           if equipment_state == "stale" and command == "vfd.stop"]
        quality = freshness(snapshot, device_session_id=context.device.last_observed_session_id, now=generated_at)
        metric_readings = readings(value_keys, snapshot, quality)
        typed_states = state_readings(state_keys, snapshot, quality)
        if snapshot is not None:
            # Некоректне історичне числове поле не ламає JSON і не стає нулем.
            numeric = {item.key: item.value for item in metric_readings}
            snapshot = snapshot.model_copy(update={
                "values": {key: numeric[key] for key in snapshot.values},
                "state": json_safe(snapshot.state),
            })
        availability = DevicePresenceService(self._session).get_availability(
            device_id=device_id, now=generated_at,
        )
        return DeviceOverviewRead(
            equipment_state=equipment_state,
            equipment_target=configuration_target(equipment_configuration),
            diagnostics=snapshot.diagnostics if snapshot else None,
            frequency_limits=configured_limits(self._session, device_id),
            generated_at=generated_at,
            device=DeviceRead.model_validate(context.device),
            access=access,
            availability=DeviceAvailabilityRead(
                device_id=availability.device_id, uid=availability.uid,
                online=availability.online, last_seen_at=availability.last_seen_at,
                timeout_seconds=availability.timeout_seconds,
                seconds_since_seen=availability.seconds_since_seen,
            ),
            capabilities=capabilities, modules=modules, value_keys=value_keys, state_keys=state_keys,
            command_types=command_types,
            allowed_commands=sorted(command for module in modules for command in module.allowed_commands),
            snapshot=snapshot,
            telemetry_freshness=quality, readings=metric_readings,
            state_readings=typed_states,
        )
