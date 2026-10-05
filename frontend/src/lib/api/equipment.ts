import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import { matchingId, type Device } from "./inventory";
import type { components } from "./schema";

export type EquipmentPassport = components["schemas"]["EquipmentPassport"];
export type EquipmentState = EquipmentPassport["configuration_state"];
export type EquipmentTarget = components["schemas"]["EquipmentTarget"];
export const equipmentStateLabels: Record<EquipmentState, string> = {
  legacy: "Паспорт ще не введено в експлуатацію",
  awaiting: "Контролер ще не підтвердив конфігурацію обладнання",
  mismatch: "Конфігурація контролера відрізняється від збереженої",
  stale: "Підтвердження обладнання застаріло; оновіть дані",
  incompatible: "Профіль або стан обладнання несумісний з керуванням",
  verified: "Конфігурацію підтверджено на момент перевірки",
};
const path = "/api/v1/devices/equipment";
export function equipmentState(value: unknown): EquipmentState {
  if (typeof value !== "string" || !Object.hasOwn(equipmentStateLabels, value)) invalidResponse(path, "equipment state");
  return value as EquipmentState;
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse(path, "equipment object");
  return value;
}
function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) invalidResponse(path, "revision");
}
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) invalidResponse(path, "configuration hash");
}
export function parseEquipmentTarget(value: unknown): EquipmentTarget | null {
  if (value === undefined || value === null) return null;
  const data = record(value);
  const bindingId = requiredUuid(data, "binding_id", path);
  revision(data.revision); hash(data.configuration_hash);
  return { binding_id: bindingId, revision: data.revision as number, configuration_hash: data.configuration_hash as string };
}
export function sameEquipmentTarget(a?: EquipmentTarget | null, b?: EquipmentTarget | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.binding_id === b.binding_id && a.revision === b.revision && a.configuration_hash === b.configuration_hash;
}
function binding(value: unknown, report: boolean) {
  const data = record(value);
  requiredUuid(data, "module_id", path); requiredUuid(data, "binding_id", path);
  for (const key of ["revision", "binding_generation", "profile_version", "driver_version"]) revision(data[key]);
  for (const key of ["profile_id", "driver_id"]) requiredString(data, key, path);
  hash(data.profile_hash);
  if (report) {
    hash(data.configuration_hash);
    if (data.command_protocol !== 3 || typeof data.compatible !== "boolean") invalidResponse(path, "equipment protocol");
  }
  return data;
}
export function parseEquipmentPassport(value: unknown, device: Device): EquipmentPassport {
  const data = record(value);
  matchingId(requiredUuid(data, "device_id", path), device.id, path);
  matchingId(requiredString(data, "controller_uid", path), device.uid, path);
  if (data.controller_id != null) requiredUuid(data, "controller_id", path);
  equipmentState(data.configuration_state);
  if (data.firmware_version !== null) requiredString(data, "firmware_version", path);
  if (!Array.isArray(data.installations) || data.installations.length > 100 || !Array.isArray(data.modules) || data.modules.length > 32) invalidResponse(path, "bounded equipment list");
  const installations = new Set(data.installations.map((raw) => {
    const item = record(raw);
    matchingId(requiredUuid(item, "site_id", path), device.site_id, path);
    requiredString(item, "name", path);
    return requiredUuid(item, "id", path);
  }));
  const modules = new Set(data.modules.map((raw) => {
    const item = record(raw);
    matchingId(requiredUuid(item, "device_id", path), device.id, path);
    if (item.retired_at != null) requiredDateTime(item, "retired_at", path);
    if (!installations.has(requiredUuid(item, "installation_id", path))) invalidResponse(path, "module installation");
    for (const key of ["slot", "name", "manufacturer", "series", "model"]) requiredString(item, key, path);
    for (const key of ["serial_number", "hardware_revision", "software_revision"]) if (item[key] !== null) requiredString(item, key, path);
    if (!["vfd", "pressure_sensor", "digital_input", "relay", "other"].includes(String(item.kind))) invalidResponse(path, "module kind");
    if (item.motor !== null) {
      const motor = record(item.motor);
      for (const key of ["rated_frequency_hz", "rated_current_a", "rated_voltage_v", "rated_power_kw"]) {
        const value = motor[key];
        if (key !== "rated_frequency_hz" && value === null) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalidResponse(path, "motor nameplate");
      }
    }
    return requiredUuid(item, "id", path);
  }));
  if (installations.size !== data.installations.length || modules.size !== data.modules.length) invalidResponse(path, "unique equipment ids");
  if (data.desired !== null) {
    const desired = record(data.desired), manifest = binding(desired.manifest, false);
    hash(desired.configuration_hash); requiredDateTime(desired, "created_at", path); requiredUuid(desired, "actor_user_id", path);
    if (manifest.version !== 1 || !modules.has(requiredUuid(manifest, "module_id", path))) invalidResponse(path, "desired module");
    matchingId(requiredString(manifest, "device_uid", path), device.uid, path);
    const limits = record(manifest.frequency_limits);
    if (typeof limits.min_hz !== "number" || typeof limits.max_hz !== "number" || !Number.isFinite(limits.min_hz) || !Number.isFinite(limits.max_hz) || limits.min_hz < 0 || limits.max_hz > 100 || limits.min_hz >= limits.max_hz) invalidResponse(path, "installation limits");
    const bus = record(manifest.bus);
    if (bus.transport !== "modbus_rtu" || typeof bus.address !== "number" || !Number.isInteger(bus.address) || bus.address < 1 || bus.address > 247 || ![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(Number(bus.baud)) || !["none", "even", "odd"].includes(String(bus.parity)) || ![1, 2].includes(Number(bus.stop_bits))) invalidResponse(path, "bus settings");
  }
  if (data.reported !== null) binding(data.reported, true);
  if (data.configuration_state === "verified") {
    if (data.desired === null || data.reported === null) invalidResponse(path, "confirmed equipment");
    const desired = record(data.desired), manifest = record(desired.manifest), report = record(data.reported);
    if (!report.compatible || report.configuration_hash !== desired.configuration_hash ||
        ["module_id", "binding_id", "revision", "binding_generation", "profile_id", "profile_version", "profile_hash", "driver_id", "driver_version"].some((key) => report[key] !== manifest[key])) invalidResponse(path, "matching equipment confirmation");
  }
  return data as EquipmentPassport;
}
