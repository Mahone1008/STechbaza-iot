import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import type { components } from "./schema";

const path = "/api/v1/connect";
export function parseConnection(value: unknown, controllerId: string): components["schemas"]["ConnectionRead"] {
  if (!isRecord(value) || value.controller_id !== controllerId || !["ready", "claimed"].includes(String(value.state)))
    return invalidResponse(path, "controller identity and state");
  const claimed = value.state === "claimed";
  if (!claimed && (value.device_id !== null || value.site_id !== null))
    return invalidResponse(path, "unclaimed controller");
  return {
    controller_id: requiredUuid(value, "controller_id", path),
    serial_number: requiredString(value, "serial_number", path),
    hardware_model: requiredString(value, "hardware_model", path),
    state: claimed ? "claimed" : "ready",
    device_id: claimed ? requiredUuid(value, "device_id", path) : null,
    site_id: claimed ? requiredUuid(value, "site_id", path) : null,
    last_contact_at: value.last_contact_at === null ? null : requiredDateTime(value, "last_contact_at", path),
    firmware_version: value.firmware_version === null ? null : requiredString(value, "firmware_version", path),
    activation_required: value.activation_required === false ? false : true,
    permanent_login: value.permanent_login == null ? null : requiredString(value, "permanent_login", path),
  };
}
export function parseRecovery(value: unknown): string {
  if (!isRecord(value) || typeof value.recovery_key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.recovery_key))
    return invalidResponse("/api/v1/auth/recovery", "recovery key");
  return value.recovery_key;
}
