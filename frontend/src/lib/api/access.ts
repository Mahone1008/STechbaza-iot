import { buildApiUrl } from "./config";
import { ApiError } from "./errors";
import type { paths } from "./schema";

export type CurrentUserResponse = paths["/api/v1/auth/me"]["get"]["responses"][200]["content"]["application/json"];
export type OrganizationListResponse = paths["/api/v1/organizations"]["get"]["responses"][200]["content"]["application/json"];
export type OrganizationResponse = OrganizationListResponse[number];
export type OrganizationAccessResponse = paths["/api/v1/organizations/{organization_id}/access"]["get"]["responses"][200]["content"]["application/json"];

export const permissionCodes = [
  "organization.read",
  "site.read",
  "site.create",
  "device.read",
  "device.create",
  "telemetry.read",
  "event.read",
  "alarm.read",
  "notification.read",
  "alarm.acknowledge",
  "command.read",
  "command.execute",
  "capability.read",
  "capability.manage",
  "membership.read",
  "membership.manage",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];
export type OrganizationRole = "owner" | "admin" | "operator" | "viewer" | "service";
export type PlatformRole = "user" | "service_admin" | "superadmin";

const permissionSet = new Set<string>(permissionCodes);
const organizationRoleSet = new Set<string>(["owner", "admin", "operator", "viewer", "service"]);
const platformRoleSet = new Set<string>(["user", "service_admin", "superadmin"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalidResponse(path: string, expected: string, details: unknown = null): never {
  throw new ApiError("Backend повернув некоректні дані.", {
    kind: "invalid-response",
    status: 200,
    method: "GET",
    url: buildApiUrl(path).toString(),
    retryAfterSeconds: null,
    requestId: null,
    details: details ?? { expected },
  });
}

export function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) invalidResponse(path, key);
  return value;
}

export function requiredUuid(record: Record<string, unknown>, key: string, path: string): string {
  const value = requiredString(record, key, path);
  if (!uuidPattern.test(value)) invalidResponse(path, `${key}: uuid`);
  return value;
}

export function requiredDateTime(record: Record<string, unknown>, key: string, path: string): string {
  const value = requiredString(record, key, path);
  if (!Number.isFinite(Date.parse(value))) invalidResponse(path, `${key}: date-time`);
  return value;
}

function parsePlatformRole(value: unknown, path: string): PlatformRole {
  if (typeof value !== "string" || !platformRoleSet.has(value)) {
    invalidResponse(path, "platform_role");
  }
  return value as PlatformRole;
}

function parseOrganizationRole(value: unknown, path: string, nullable = false): OrganizationRole | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !organizationRoleSet.has(value)) {
    invalidResponse(path, "organization_role");
  }
  return value as OrganizationRole;
}

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === "string" && permissionSet.has(value);
}

export function parseCurrentUserResponse(value: unknown): CurrentUserResponse {
  const path = "/api/v1/auth/me";
  if (!isRecord(value)) invalidResponse(path, "CurrentUserRead");

  const membershipsValue = value.memberships;
  if (!Array.isArray(membershipsValue)) invalidResponse(path, "memberships[]");
  const memberships = membershipsValue.map((membership) => {
    if (!isRecord(membership)) invalidResponse(path, "CurrentUserMembershipRead");
    return {
      organization_id: requiredUuid(membership, "organization_id", path),
      role: parseOrganizationRole(membership.role, path),
    };
  });

  if (typeof value.is_active !== "boolean") invalidResponse(path, "is_active");

  return {
    id: requiredUuid(value, "id", path),
    email: requiredString(value, "email", path),
    display_name: typeof value.display_name === "string" ? value.display_name : invalidResponse(path, "display_name"),
    platform_role: parsePlatformRole(value.platform_role, path),
    is_active: value.is_active,
    auth_session_id: requiredUuid(value, "auth_session_id", path),
    auth_session_expires_at: requiredDateTime(value, "auth_session_expires_at", path),
    memberships,
  } as CurrentUserResponse;
}

export function parseOrganization(value: unknown, path: string): OrganizationResponse {
  if (!isRecord(value)) invalidResponse(path, "OrganizationRead");
  if (typeof value.is_active !== "boolean") invalidResponse(path, "is_active");

  return {
    id: requiredUuid(value, "id", path),
    name: requiredString(value, "name", path),
    slug: requiredString(value, "slug", path),
    is_active: value.is_active,
    created_at: requiredDateTime(value, "created_at", path),
    updated_at: requiredDateTime(value, "updated_at", path),
  } as OrganizationResponse;
}

export function parseOrganizationListResponse(value: unknown): OrganizationListResponse {
  const path = "/api/v1/organizations";
  if (!Array.isArray(value) || value.length > 100) invalidResponse(path, "OrganizationRead[]");
  return value.map((item) => parseOrganization(item, path)) as OrganizationListResponse;
}

export function parseOrganizationAccessResponse(
  value: unknown,
  organizationId: string,
): OrganizationAccessResponse {
  const path = `/api/v1/organizations/${encodeURIComponent(organizationId)}/access`;
  if (!isRecord(value)) invalidResponse(path, "OrganizationAccessRead");

  const responseOrganizationId = requiredUuid(value, "organization_id", path);
  if (responseOrganizationId !== organizationId) {
    invalidResponse(path, "matching organization_id", { expected: organizationId, received: responseOrganizationId });
  }

  if (!Array.isArray(value.permissions) || !value.permissions.every(isPermissionCode)) {
    invalidResponse(path, "permissions[]");
  }

  const permissions = [...new Set(value.permissions)] as PermissionCode[];
  return {
    organization_id: responseOrganizationId,
    platform_role: parsePlatformRole(value.platform_role, path),
    organization_role: parseOrganizationRole(value.organization_role, path, true),
    permissions,
  } as OrganizationAccessResponse;
}

export function organizationRoleLabel(
  role: OrganizationRole | null,
  platformRole: string = "user",
): string {
  if (role === "owner") return "Власник";
  if (role === "admin") return "Адміністратор";
  if (role === "operator") return "Оператор";
  if (role === "viewer") return "Спостерігач";
  if (role === "service") return "Сервісний спеціаліст";
  if (platformRole === "superadmin") return "Суперадміністратор";
  if (platformRole === "service_admin") return "Адміністратор сервісу";
  return "Користувач";
}
