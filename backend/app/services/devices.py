import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.device import Device
from app.repositories.devices import DeviceRepository
from app.repositories.sites import SiteRepository
from app.schemas.device import DeviceCreate


class DeviceAlreadyExistsError(Exception):
    """Пристрій з таким uid уже зареєстрований."""


class DeviceNotFoundError(Exception):
    """Пристрій не знайдено."""


class ParentSiteNotFoundError(Exception):
    """Батьківський Site не знайдено."""


class DeviceService:
    """Бізнес-логіка реєстрації та читання пристроїв."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._devices = DeviceRepository(session)
        self._sites = SiteRepository(session)

    def list_for_site(
        self,
        site_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[Device]:
        if self._sites.get(site_id) is None:
            raise ParentSiteNotFoundError

        return self._devices.list_for_site(
            site_id,
            limit=limit,
            offset=offset,
        )

    def get(self, device_id: uuid.UUID) -> Device:
        device = self._devices.get(device_id)
        if device is None:
            raise DeviceNotFoundError
        return device

    def create(
        self,
        site_id: uuid.UUID,
        payload: DeviceCreate,
    ) -> Device:
        if self._sites.get(site_id) is None:
            raise ParentSiteNotFoundError

        # uid має бути глобально унікальним: один фізичний контролер не може
        # одночасно бути зареєстрований на двох об'єктах.
        if self._devices.get_by_uid(payload.uid) is not None:
            raise DeviceAlreadyExistsError

        device = Device(
            site_id=site_id,
            uid=payload.uid,
            name=payload.name.strip(),
            device_type=payload.device_type,
            lifecycle_status="provisioning",
        )

        try:
            created = self._devices.add(device)
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise DeviceAlreadyExistsError from exc

        return created
