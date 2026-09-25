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


class Permission(StrEnum):
    """Атомарні tenant permissions, які не залежать від HTTP endpoint."""

    ORGANIZATION_READ = "organization.read"
    SITE_READ = "site.read"
    SITE_CREATE = "site.create"
    DEVICE_READ = "device.read"
    DEVICE_CREATE = "device.create"
    TELEMETRY_READ = "telemetry.read"
    EVENT_READ = "event.read"
    ALARM_READ = "alarm.read"
    COMMAND_READ = "command.read"
    COMMAND_EXECUTE = "command.execute"
    CAPABILITY_READ = "capability.read"
    CAPABILITY_MANAGE = "capability.manage"
    MEMBERSHIP_READ = "membership.read"
    MEMBERSHIP_MANAGE = "membership.manage"


ORGANIZATION_ROLE_PERMISSIONS: dict[OrganizationRole, frozenset[Permission]] = {
    OrganizationRole.OWNER: frozenset(Permission),
    OrganizationRole.ADMIN: frozenset(
        {
            Permission.ORGANIZATION_READ,
            Permission.SITE_READ,
            Permission.SITE_CREATE,
            Permission.DEVICE_READ,
            Permission.DEVICE_CREATE,
            Permission.TELEMETRY_READ,
            Permission.EVENT_READ,
            Permission.ALARM_READ,
            Permission.COMMAND_READ,
            Permission.COMMAND_EXECUTE,
            Permission.CAPABILITY_READ,
            Permission.CAPABILITY_MANAGE,
            Permission.MEMBERSHIP_READ,
            Permission.MEMBERSHIP_MANAGE,
        }
    ),
    OrganizationRole.OPERATOR: frozenset(
        {
            Permission.ORGANIZATION_READ,
            Permission.SITE_READ,
            Permission.DEVICE_READ,
            Permission.TELEMETRY_READ,
            Permission.EVENT_READ,
            Permission.ALARM_READ,
            Permission.COMMAND_READ,
            Permission.COMMAND_EXECUTE,
            Permission.CAPABILITY_READ,
        }
    ),
    OrganizationRole.VIEWER: frozenset(
        {
            Permission.ORGANIZATION_READ,
            Permission.SITE_READ,
            Permission.DEVICE_READ,
            Permission.TELEMETRY_READ,
            Permission.EVENT_READ,
            Permission.ALARM_READ,
            Permission.COMMAND_READ,
            Permission.CAPABILITY_READ,
        }
    ),
    OrganizationRole.SERVICE: frozenset(
        {
            Permission.ORGANIZATION_READ,
            Permission.SITE_READ,
            Permission.DEVICE_READ,
            Permission.DEVICE_CREATE,
            Permission.TELEMETRY_READ,
            Permission.EVENT_READ,
            Permission.ALARM_READ,
            Permission.COMMAND_READ,
            Permission.COMMAND_EXECUTE,
            Permission.CAPABILITY_READ,
            Permission.CAPABILITY_MANAGE,
        }
    ),
}


def role_has_permission(
    role: OrganizationRole | str,
    permission: Permission,
) -> bool:
    """Єдина таблиця істини для organization-level RBAC."""

    try:
        normalized_role = OrganizationRole(role)
    except ValueError:
        return False

    return permission in ORGANIZATION_ROLE_PERMISSIONS[normalized_role]
