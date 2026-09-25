import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.capability import Capability, DeviceCapability
from app.repositories.capabilities import CapabilityRepository
from app.repositories.devices import DeviceRepository
from app.schemas.alarm_rule import parse_alarm_rules
from app.schemas.capability import (
    CapabilityCreate,
    DeviceCapabilityAssign,
    DeviceCapabilityUpdate,
)


class CapabilityAlreadyExistsError(Exception):
    """Capability з таким code уже існує."""


class CapabilityNotFoundError(Exception):
    """Capability не знайдено."""


class ParentDeviceNotFoundError(Exception):
    """Пристрій не знайдено."""


class DeviceCapabilityAlreadyExistsError(Exception):
    """Capability уже прив'язаний до цього пристрою."""


class DeviceAlarmRulesConflictError(Exception):
    """Активні правила різних capabilities мають однаковий ключ."""


class CapabilityService:
    """Бізнес-логіка каталогу capabilities та їх призначення пристроям."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._capabilities = CapabilityRepository(session)
        self._devices = DeviceRepository(session)

    def list_catalog(self, *, limit: int, offset: int) -> list[Capability]:
        return self._capabilities.list_catalog(limit=limit, offset=offset)

    def create_catalog_item(self, payload: CapabilityCreate) -> Capability:
        if self._capabilities.get_by_code(payload.code) is not None:
            raise CapabilityAlreadyExistsError

        capability = Capability(
            code=payload.code,
            name=payload.name.strip(),
            description=payload.description.strip() if payload.description else None,
        )

        try:
            created = self._capabilities.add_catalog_item(capability)
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise CapabilityAlreadyExistsError from exc

        return created

    def list_for_device(self, device_id: uuid.UUID) -> list[DeviceCapability]:
        if self._devices.get(device_id) is None:
            raise ParentDeviceNotFoundError

        return self._capabilities.list_for_device(device_id)

    def assign_to_device(
        self,
        device_id: uuid.UUID,
        capability_id: uuid.UUID,
        payload: DeviceCapabilityAssign,
    ) -> DeviceCapability:
        if self._devices.lock_id(device_id) is None:
            raise ParentDeviceNotFoundError

        if self._capabilities.get(capability_id) is None:
            raise CapabilityNotFoundError

        if self._capabilities.get_assignment(device_id, capability_id) is not None:
            raise DeviceCapabilityAlreadyExistsError

        self._validate_device_rule_keys(
            device_id, capability_id, payload.is_enabled, payload.config
        )

        assignment = DeviceCapability(
            device_id=device_id,
            capability_id=capability_id,
            is_enabled=payload.is_enabled,
            config=payload.config,
        )

        try:
            created = self._capabilities.add_assignment(assignment)
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise DeviceCapabilityAlreadyExistsError from exc

        # Повторно читаємо із eager loading, щоб API-відповідь не залежала
        # від lazy loading після commit.
        result = self._capabilities.get_assignment(device_id, capability_id)
        assert result is not None
        return result


    def update_assignment(
        self,
        device_id: uuid.UUID,
        capability_id: uuid.UUID,
        payload: DeviceCapabilityUpdate,
    ) -> DeviceCapability:
        if self._devices.lock_id(device_id) is None:
            raise ParentDeviceNotFoundError

        assignment = self._capabilities.get_assignment(
            device_id,
            capability_id,
        )
        if assignment is None:
            raise CapabilityNotFoundError

        self._validate_device_rule_keys(
            device_id,
            capability_id,
            payload.is_enabled if payload.is_enabled is not None else assignment.is_enabled,
            payload.config if payload.config is not None else assignment.config,
        )

        if payload.is_enabled is not None:
            assignment.is_enabled = payload.is_enabled

        if payload.config is not None:
            assignment.config = payload.config

        self._capabilities.update_assignment(assignment)
        self._session.commit()

        result = self._capabilities.get_assignment(
            device_id,
            capability_id,
        )
        assert result is not None
        return result

    def _validate_device_rule_keys(
        self, device_id: uuid.UUID, capability_id: uuid.UUID,
        is_enabled: bool, config: dict,
    ) -> None:
        """Перевірка під Device lock відхиляє конфлікт ще до commit."""

        if not is_enabled:
            return
        keys = {rule.rule_key for rule in parse_alarm_rules(config) if rule.enabled}
        for assignment in self._capabilities.get_enabled_assignments_for_device(device_id):
            if assignment.capability_id == capability_id:
                continue
            other = {
                rule.rule_key for rule in parse_alarm_rules(assignment.config)
                if rule.enabled
            }
            if keys & other:
                raise DeviceAlarmRulesConflictError
