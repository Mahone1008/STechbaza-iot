import uuid
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


Password = Annotated[str, StringConstraints(strip_whitespace=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True, str_strip_whitespace=True)


class RecoveryRequest(StrictModel):
    email: str = Field(min_length=1, max_length=320)
    recovery_key: str = Field(min_length=32, max_length=100)
    new_password: Password = Field(min_length=12, max_length=128)


class RecoveryRead(StrictModel):
    recovery_key: str


class SecurityProof(StrictModel):
    otp: str | None = Field(default=None, pattern=r"^[0-9]{6}$")
    password: Password = Field(min_length=1, max_length=128)


class PasswordChange(SecurityProof):
    new_password: Password = Field(min_length=12, max_length=128)


class TotpConfirm(StrictModel):
    otp: str = Field(pattern=r"^[0-9]{6}$")


class SecurityRead(StrictModel):
    mfa_enabled: bool
    privileged_mfa_required: bool
    current_session_verified: bool
    recovery_available: bool


class TotpSetupRead(StrictModel):
    secret: str
    uri: str


class ActivationAccessRead(StrictModel):
    login: str
    recovery_key: str


class SessionRead(StrictModel):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    current: bool


class FactoryCreate(StrictModel):
    serial_number: str = Field(min_length=3, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    hardware_model: str = Field(min_length=2, max_length=80)
    hardware_revision: str = Field(min_length=1, max_length=80)
    batch: str = Field(min_length=1, max_length=80)
    test_reference: str = Field(min_length=1, max_length=160)
    factory_test_passed: Literal[True]


class FactoryRead(StrictModel):
    id: uuid.UUID
    serial_number: str
    hardware_model: str
    hardware_revision: str
    batch: str
    distributor: str | None
    status: str
    generation: int
    device_id: uuid.UUID | None
    claimed_at: datetime | None
    last_contact_at: datetime | None
    credential_revision: int = 0
    access_revoked: bool = False


class FactorySecrets(StrictModel):
    controller: FactoryRead
    qr_path: str
    activation_code: str
    bootstrap_key: str
    setup_password: str
    login: str
    password: str


class ShipmentRequest(StrictModel):
    distributor: str = Field(min_length=2, max_length=160)
    reference: str = Field(min_length=1, max_length=160)


class FactoryQuarantine(StrictModel):
    reason: str = Field(min_length=5, max_length=240)


class FactoryReset(FactoryQuarantine):
    expected_generation: int = Field(ge=1)
    test_reference: str = Field(min_length=1, max_length=160)
    factory_test_passed: Literal[True]


class NewSite(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    timezone: str = Field(default="Europe/Kyiv", min_length=3, max_length=64)
    organization_id: uuid.UUID | None = None
    organization_name: str | None = Field(default=None, min_length=2, max_length=160)

    @model_validator(mode="after")
    def one_organization(self):
        if self.organization_id is not None and self.organization_name is not None:
            raise ValueError("Оберіть наявну організацію або створіть нову")
        return self

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Оберіть чинний часовий пояс") from exc
        return value


class ClaimRequest(StrictModel):
    activation_code: str | None = Field(default=None, min_length=32, max_length=100)
    device_name: str = Field(min_length=2, max_length=160)
    site_id: uuid.UUID | None = None
    new_site: NewSite | None = None
    new_password: Password | None = Field(default=None, min_length=12, max_length=128)

    @model_validator(mode="after")
    def exactly_one_site(self):
        if (self.site_id is None) == (self.new_site is None):
            raise ValueError("Створіть новий об’єкт або оберіть один наявний")
        return self


class ConnectionRead(StrictModel):
    controller_id: uuid.UUID
    serial_number: str
    hardware_model: str
    state: Literal["ready", "claimed"]
    device_id: uuid.UUID | None
    site_id: uuid.UUID | None
    last_contact_at: datetime | None
    firmware_version: str | None
    activation_required: bool = True
    permanent_login: str | None = None


class EquipmentSelection(StrictModel):
    profile_id: str = Field(min_length=1, max_length=96)
    profile_version: int = Field(ge=1, le=2147483647)
    model: str = Field(min_length=1, max_length=120)
    hardware_revision: str | None = Field(default=None, max_length=80)
    software_revision: str | None = Field(default=None, max_length=80)
    nameplate_confirmed: Literal[True]


class BootstrapContact(StrictModel):
    firmware_version: str = Field(min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9._-]+$")


class BootstrapConfiguration(StrictModel):
    state: Literal["waiting", "configured", "revoked"]
    device_uid: str | None = None
    mqtt_host: str | None = None
    mqtt_port: int | None = None
    mqtt_password: str | None = None
    credential_revision: int = 0
    manifest: str | None = None
    configuration_hash: str | None = None


class ControllerOperation(SecurityProof):
    expected_generation: int = Field(ge=1)
    expected_credential_revision: int = Field(ge=0)
    reason: str = Field(min_length=5, max_length=240)
    stopped_and_isolated: Literal[True]


class TransferRead(StrictModel):
    controller_id: uuid.UUID
    qr_path: str
    activation_code: str
    generation: int
    login: str
    password: str


class ControllerStatus(StrictModel):
    controller_id: uuid.UUID
    generation: int
    credential_revision: int
    access_revoked: bool
    last_contact_at: datetime | None
    credential_state: Literal["not_issued", "pending", "active", "revoked"]
