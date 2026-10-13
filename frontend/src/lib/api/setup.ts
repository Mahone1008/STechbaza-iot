import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import type { components } from "./schema";

export type SetupEquipment = {
  profile_id: string | null;
  profile_version: number;
  model: string | null;
  serial_number: string | null;
  hardware_revision: string | null;
  software_revision: string | null;
  motor: {
    rated_frequency_hz: number | null;
    rated_current_a: number | null;
    rated_voltage_v: number | null;
    rated_power_kw: number | null;
  } | null;
  frequency_limits: { min_hz: number; max_hz: number } | null;
};
export type SetupProfile = Pick<
  components["schemas"]["ProfileRead"],
  "id" | "version" | "manufacturer" | "series" | "support" | "tested_model"
>;
export type SetupSnapshot = {
  generation: number;
  credential_revision: number;
  configuration_revision: number;
  draft_revision: number;
  equipment: SetupEquipment;
  missing_fields: string[];
};
export type OwnerSetupRead = SetupSnapshot & {
  controller_id: string;
  device_id: string;
  configuration_hash: string | null;
  initial_setup_open: boolean;
  can_setup: boolean;
  completed_at: string | null;
  commissioned_control_mode: "extended_test" | "bench_without_motor" | "read_only" | null;
  applied_draft_revision: number | null;
  configured_equipment: SetupEquipment | null;
  checks: { code: string; title: string; status: "passed" | "pending" | "blocked"; detail: string | null }[];
  progress: "activated" | "connected" | "ready";
  needs_apply: boolean;
  draft_stale: boolean;
  can_apply: boolean;
  can_accept_control: boolean;
  can_accept_read_only: boolean;
};

const path = "/api/v1/connect/setup";
function revision(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > 2147483647)
    return invalidResponse(path, "setup revision");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalidResponse(path, "setup object");
  return value;
}
function bool(data: Record<string, unknown>, key: string): boolean {
  if (typeof data[key] !== "boolean") return invalidResponse(path, key);
  return data[key];
}
export function parseSetupEquipment(value: unknown): SetupEquipment {
  const data = record(value);
  revision(data.profile_version, 1);
  for (const key of ["profile_id", "model", "serial_number", "hardware_revision", "software_revision"])
    if (data[key] !== null && typeof data[key] !== "string") invalidResponse(path, key);
  if (data.motor !== null) {
    const motor = record(data.motor);
    for (const key of ["rated_frequency_hz", "rated_current_a", "rated_voltage_v", "rated_power_kw"])
      if (motor[key] !== null && (typeof motor[key] !== "number" || !Number.isFinite(motor[key]) || motor[key] <= 0))
        invalidResponse(path, "motor nameplate");
  }
  if (data.frequency_limits !== null) {
    const limits = record(data.frequency_limits);
    if (
      typeof limits.min_hz !== "number" ||
      typeof limits.max_hz !== "number" ||
      !Number.isFinite(limits.min_hz) ||
      !Number.isFinite(limits.max_hz) ||
      limits.min_hz < 0 ||
      limits.max_hz > 100 ||
      limits.min_hz >= limits.max_hz
    )
      invalidResponse(path, "frequency limits");
  }
  return data as SetupEquipment;
}
export function parseSetupSnapshot(value: unknown): SetupSnapshot {
  const data = record(value);
  if (
    !Array.isArray(data.missing_fields) ||
    data.missing_fields.length > 32 ||
    data.missing_fields.some((item) => typeof item !== "string")
  )
    return invalidResponse(path, "missing equipment fields");
  return {
    generation: revision(data.generation, 1),
    credential_revision: revision(data.credential_revision),
    configuration_revision: revision(data.configuration_revision),
    draft_revision: revision(data.draft_revision),
    equipment: parseSetupEquipment(data.equipment),
    missing_fields: data.missing_fields,
  };
}
export function parseOwnerSetup(value: unknown, controllerId: string, deviceId: string): OwnerSetupRead {
  const data = record(value);
  if (requiredUuid(data, "controller_id", path) !== controllerId || requiredUuid(data, "device_id", path) !== deviceId)
    return invalidResponse(path, "controller setup identity");
  const snapshot = parseSetupSnapshot(data);
  if (
    data.configuration_hash !== null &&
    (typeof data.configuration_hash !== "string" || !/^[a-f0-9]{64}$/u.test(data.configuration_hash))
  )
    invalidResponse(path, "configuration hash");
  if (data.completed_at !== null) requiredDateTime(data, "completed_at", path);
  const mode = data.commissioned_control_mode ?? null;
  if (mode !== null && !["extended_test", "bench_without_motor", "read_only"].includes(String(mode)))
    invalidResponse(path, "commissioned mode");
  if (data.applied_draft_revision !== null) revision(data.applied_draft_revision);
  if (data.configured_equipment !== null) parseSetupEquipment(data.configured_equipment);
  if (!["activated", "connected", "ready"].includes(String(data.progress))) invalidResponse(path, "setup progress");
  if (!Array.isArray(data.checks) || data.checks.length > 32) return invalidResponse(path, "setup checks");
  for (const raw of data.checks) {
    const check = record(raw);
    requiredString(check, "code", path);
    requiredString(check, "title", path);
    if (
      !["passed", "pending", "blocked"].includes(String(check.status)) ||
      (check.detail !== null && typeof check.detail !== "string")
    )
      invalidResponse(path, "setup check");
  }
  for (const key of [
    "can_setup",
    "initial_setup_open",
    "needs_apply",
    "can_apply",
    "can_accept_control",
    "can_accept_read_only",
  ])
    bool(data, key);
  if (
    data.can_accept_control &&
    (!data.configuration_hash || data.needs_apply || !data.can_setup || !data.initial_setup_open)
  )
    invalidResponse(path, "control acceptance");
  if (data.draft_stale !== undefined && typeof data.draft_stale !== "boolean") invalidResponse(path, "draft context");
  return {
    ...data,
    ...snapshot,
    draft_stale: data.draft_stale === true,
    commissioned_control_mode: mode,
  } as OwnerSetupRead;
}
export function parseSetupProfiles(value: unknown): SetupProfile[] {
  if (!Array.isArray(value) || value.length > 100) return invalidResponse(path, "setup profiles");
  return value.map((raw) => {
    const data = record(raw);
    for (const key of ["id", "manufacturer", "series", "support"]) requiredString(data, key, path);
    revision(data.version, 1);
    if (data.tested_model !== null && typeof data.tested_model !== "string") invalidResponse(path, "tested model");
    return data as SetupProfile;
  });
}
export function setupScope(value: SetupSnapshot) {
  return {
    expected_generation: value.generation,
    expected_credential_revision: value.credential_revision,
    expected_configuration_revision: value.configuration_revision,
    expected_draft_revision: value.draft_revision,
  };
}
/** Форма зберігає прив’язку до установки й чернетки, показаних під час відкриття. */
export function setupSnapshotKey(value: SetupSnapshot): string {
  return [value.generation, value.credential_revision, value.configuration_revision, value.draft_revision].join(":");
}

export type SetupHelperLink = {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  active: boolean;
};
export type SetupHelperRead = SetupSnapshot & {
  helper_id: string;
  expires_at: string;
  serial_number: string;
  checks: OwnerSetupRead["checks"];
  progress: OwnerSetupRead["progress"];
  profiles: SetupProfile[];
};
export function parseHelperLinks(value: unknown): SetupHelperLink[] {
  if (!Array.isArray(value) || value.length > 100) return invalidResponse(path, "helper links");
  return value.map((raw) => {
    const data = record(raw);
    requiredUuid(data, "id", path);
    requiredDateTime(data, "created_at", path);
    requiredDateTime(data, "expires_at", path);
    if (data.revoked_at !== null) requiredDateTime(data, "revoked_at", path);
    bool(data, "active");
    return data as SetupHelperLink;
  });
}
export function parseCreatedHelper(value: unknown): SetupHelperLink & { token: string } {
  const data = record(value),
    link = parseHelperLinks([data])[0]!;
  const token = requiredString(data, "token", path);
  if (!/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/u.test(token)) return invalidResponse(path, "helper proof");
  if (helperProofId(token) !== link.id) return invalidResponse(path, "helper proof identity");
  return { ...link, token };
}
export function helperProofId(token: string): string {
  const id = token.slice(0, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
export function parseSetupHelper(value: unknown, helperId?: string): SetupHelperRead {
  const data = record(value),
    id = requiredUuid(data, "helper_id", path);
  if (helperId && id !== helperId) return invalidResponse(path, "helper scope");
  requiredDateTime(data, "expires_at", path);
  requiredString(data, "serial_number", path);
  if (!["activated", "connected", "ready"].includes(String(data.progress))) invalidResponse(path, "helper progress");
  if (!Array.isArray(data.checks) || data.checks.length > 32) return invalidResponse(path, "helper checks");
  for (const raw of data.checks) {
    const check = record(raw);
    requiredString(check, "code", path);
    requiredString(check, "title", path);
    if (
      !["passed", "pending", "blocked"].includes(String(check.status)) ||
      (check.detail !== null && typeof check.detail !== "string")
    )
      invalidResponse(path, "helper check");
  }
  return { ...data, ...parseSetupSnapshot(data), profiles: parseSetupProfiles(data.profiles) } as SetupHelperRead;
}
