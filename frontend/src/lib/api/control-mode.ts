import { invalidResponse, isRecord, requiredDateTime, requiredUuid } from "./access";
import type { components } from "./schema";

export type ControlMode = components["schemas"]["ControlModeRead"];
export type ControlModeInput = components["schemas"]["ControlModeWrite"];
export const controlModeLabels: Record<ControlMode["mode"], string> = { manual: "Ручне керування", schedule: "За розкладом" };

export function parseControlMode(raw: unknown, deviceId: string): ControlMode | null {
  if (raw === undefined || raw === null) return null;
  const path = "/api/v1/devices/control-mode";
  if (!isRecord(raw)) invalidResponse(path, "control mode");
  requiredUuid(raw, "device_id", path);
  if (raw.device_id !== deviceId || (raw.mode !== "manual" && raw.mode !== "schedule")
    || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || Number(raw.revision) > 2147483647
    || !Number.isSafeInteger(raw.enabled_schedule_count) || Number(raw.enabled_schedule_count) < 0 || Number(raw.enabled_schedule_count) > 50)
    invalidResponse(path, "control mode scope or revision");
  for (const key of ["changed_at", "next_start_at"]) if (raw[key] !== null) requiredDateTime(raw, key, path);
  return raw as ControlMode;
}
