from enum import StrEnum


class PlatformRole(StrEnum):
    """Глобальна роль користувача на рівні всієї платформи."""

    USER = "user"
    SERVICE_ADMIN = "service_admin"
    SUPERADMIN = "superadmin"


class OrganizationRole(StrEnum):
    """Роль користувача всередині конкретної організації."""

    OWNER = "owner"
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"
    SERVICE = "service"


PLATFORM_ROLE_VALUES = tuple(role.value for role in PlatformRole)
ORGANIZATION_ROLE_VALUES = tuple(role.value for role in OrganizationRole)
