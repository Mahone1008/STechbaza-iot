import { invalidResponse, isRecord, parseOrganizationAccessResponse, requiredDateTime, requiredString, requiredUuid } from "./access";
import { matchingId, parseAvailability, parseDevice, type Device } from "./inventory";
import type { components } from "./schema";
type Schemas = components["schemas"];
export type Quality = Schemas["MetricReadingRead"]["status"];
export type Freshness = Schemas["TelemetryFreshnessRead"];
export type Channel = Readonly<{ key: string; source: string; data_type: string; unit: string | null; supports_series?: boolean }>;
export type Reading = Readonly<{ value: number | boolean | null; status: Quality }>;
export type Module = Readonly<{ assignmentId: string; code: string; name: string; supported: boolean; channels: (Channel & Reading)[]; commands: string[]; allowedCommands: string[] }>;
export type Overview = Readonly<{ generatedAt: string; device: Device; availability: Schemas["DeviceAvailabilityRead"]; freshness: Freshness; modules: Module[]; allowedCommands: string[]; frequencyLimits: { min_hz: number; max_hz: number } | null }>;
const path = "/api/v1/devices/overview";
const qualities = new Set(["fresh", "stale", "missing", "invalid"]);
const reasons = new Set(["no_telemetry", "recent", "timeout", "session_changed", "future_timestamp", "delayed_report"]);
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) invalidResponse(path, "object"); return value; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalidResponse(path, "array"); return value; }
function strings(value: unknown): string[] { return array(value).map((item) => typeof item === "string" && item.length ? item : invalidResponse(path, "string[]")); }
function unique(values: string[]) { if (new Set(values).size !== values.length) invalidResponse(path, "unique keys"); }
function date(value: Record<string, unknown>, key: string): string | null { return value[key] === null ? null : requiredDateTime(value, key, path); }
export function parseFreshness(value: unknown): Freshness {
  const data = record(value);
  if (typeof data.status !== "string" || typeof data.reason !== "string" || !["fresh", "stale", "missing"].includes(data.status) || !reasons.has(data.reason)) invalidResponse(path, "freshness status/reason");
  const age = data.received_age_seconds;
  const threshold = data.stale_after_seconds;
  if (age !== null && (typeof age !== "number" || !Number.isFinite(age) || age < 0)) invalidResponse(path, "received age");
  if (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold <= 0) invalidResponse(path, "stale threshold");
  const received = date(data, "received_at");
  const reported = date(data, "reported_at");
  if (data.status === "missing" ? (data.reason !== "no_telemetry" || received !== null || age !== null) : (received === null || age === null || data.reason === "no_telemetry")) invalidResponse(path, "coherent freshness");
  if ((data.status === "fresh") !== (data.reason === "recent")) invalidResponse(path, "fresh reason");
  return { status: data.status, reason: data.reason, received_at: received, reported_at: reported, received_age_seconds: age, stale_after_seconds: threshold } as Freshness;
}
export function channelSupported(channel: Channel): boolean {
  return (channel.source === "values" && channel.data_type === "number") || (channel.source === "state" && ["boolean", "integer"].includes(channel.data_type));
}
function parseReading(raw: unknown, channel: Channel): Reading {
  if (!channelSupported(channel)) return { status: "missing", value: null };
  const data = record(raw);
  if (typeof data.status !== "string" || !qualities.has(data.status)) invalidResponse(path, "reading status");
  if (channel.source === "values" && data.unit !== channel.unit) invalidResponse(path, "matching unit");
  const status = data.status as Quality;
  if (status === "missing" || status === "invalid") {
    if (data.value !== null) invalidResponse(path, "missing/invalid must be null");
    return { status, value: null };
  }
  const value = data.value;
  const valid = channel.data_type === "boolean" ? typeof value === "boolean" : typeof value === "number" && Number.isFinite(value) && (channel.data_type !== "integer" || Number.isSafeInteger(value));
  if (!valid) invalidResponse(path, "typed finite reading");
  return { status, value: value as number | boolean };
}
// Only validated display fields are cached; raw snapshot/config never reaches widgets.
export function parseOverview(value: unknown, expected: Device, organizationId: string): Overview {
  const data = record(value);
  const device = parseDevice(data.device, expected.site_id, expected.id);
  matchingId(device.uid, expected.uid, path);
  const access = parseOrganizationAccessResponse(data.access, organizationId);
  if (!["device.read", "capability.read", "telemetry.read"].every((permission) => (access.permissions as string[]).includes(permission))) invalidResponse(path, "overview read permissions");
  const freshness = parseFreshness(data.telemetry_freshness);
  const capabilities = array(data.capabilities).map((raw) => { const cap = record(raw); return { id: requiredUuid(cap, "id", path), code: requiredString(cap, "code", path), name: requiredString(cap, "name", path) }; });
  unique(capabilities.map((cap) => cap.id)); unique(capabilities.map((cap) => cap.code));
  const readings = new Map<string, unknown>();
  for (const [source, list] of [["values", data.readings], ["state", data.state_readings]] as const) for (const raw of array(list)) {
    const item = record(raw); const key = `${source}:${requiredString(item, "key", path)}`;
    if (readings.has(key)) invalidResponse(path, "unique readings");
    readings.set(key, item);
  }
  const channelKeys: string[] = [];
  const modules = array(data.modules).map((raw): Module => {
    const item = record(raw);
    const capabilityId = requiredUuid(item, "capability_id", path); const code = requiredString(item, "code", path);
    const cap = capabilities.find((candidate) => candidate.id === capabilityId && candidate.code === code);
    if (!cap || typeof item.supported !== "boolean") invalidResponse(path, "assigned capability");
    const channels = array(item.channels).map((rawChannel) => {
      const ch = record(rawChannel);
      if (ch.unit !== null && typeof ch.unit !== "string") invalidResponse(path, "channel unit");
      if (typeof ch.supports_series !== "boolean") invalidResponse(path, "supports_series flag");
      const channel: Channel = { key: requiredString(ch, "key", path), source: requiredString(ch, "source", path), data_type: requiredString(ch, "data_type", path), unit: ch.unit, supports_series: ch.supports_series };
      const key = `${channel.source}:${channel.key}`; channelKeys.push(key);
      const reading = parseReading(readings.get(key), channel);
      if (reading.status === "fresh" && freshness.status !== "fresh") invalidResponse(path, "coherent reading quality");
      return { ...channel, ...reading };
    });
    const commands = strings(item.command_types);
    const allowedCommands = strings(item.allowed_commands);
    unique(commands); unique(allowedCommands);
    if (allowedCommands.some((command) => !commands.includes(command)) || (!access.permissions.includes("command.execute") && allowedCommands.length)) invalidResponse(path, "allowed commands");
    if (!item.supported && (channels.length || commands.length)) invalidResponse(path, "unsupported module");
    return { assignmentId: requiredUuid(item, "assignment_id", path), code, name: cap.name, supported: item.supported, channels, commands, allowedCommands };
  });
  unique(modules.map((module) => module.assignmentId)); unique(modules.map((module) => module.code)); unique(channelKeys);
  if (modules.length !== capabilities.length || [...readings.keys()].some((key) => !channelKeys.includes(key))) invalidResponse(path, "assigned channels only");
  const allowedCommands = strings(data.allowed_commands); const commandTypes = strings(data.command_types);
  unique(allowedCommands); unique(commandTypes);
  const moduleCommands = modules.flatMap((module) => module.commands); const moduleAllowed = modules.flatMap((module) => module.allowedCommands);
  if (commandTypes.length !== moduleCommands.length || commandTypes.some((item) => !moduleCommands.includes(item)) || allowedCommands.length !== moduleAllowed.length || allowedCommands.some((item) => !moduleAllowed.includes(item))) invalidResponse(path, "consistent command permissions");
  let frequencyLimits: Overview["frequencyLimits"] = null;
  if (data.frequency_limits !== undefined && data.frequency_limits !== null) {
    const limits = record(data.frequency_limits), min = limits.min_hz, max = limits.max_hz;
    if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min >= max) invalidResponse(path, "frequency limits");
    frequencyLimits = { min_hz: min, max_hz: max };
  }
  return { frequencyLimits, allowedCommands, generatedAt: requiredDateTime(data, "generated_at", path), device, availability: parseAvailability(data.availability, device), freshness, modules };
}
export function effectiveQuality(status: Quality, freshness: Freshness, elapsedSeconds: number): Quality {
  if (status !== "fresh") return status;
  const age = freshness.received_age_seconds ?? Infinity;
  const lag = freshness.reported_at && freshness.received_at ? Math.max(0, (Date.parse(freshness.received_at) - Date.parse(freshness.reported_at)) / 1000) : 0;
  return freshness.status !== "fresh" || age + lag + Math.max(0, elapsedSeconds) > freshness.stale_after_seconds ? "stale" : "fresh";
}
export const qualityLabels: Record<Quality, string> = { fresh: "Свіжі дані", stale: "Застарілі дані", missing: "Немає даних", invalid: "Некоректні дані" };
export const reasonLabels: Record<Freshness["reason"], string> = { no_telemetry: "Телеметрія ще не надходила", recent: "Телеметрія отримана нещодавно", timeout: "Перевищено час актуальності", session_changed: "Контролер змінив сесію; показання належать попередній сесії", future_timestamp: "Час контролера або повідомлення потребує перевірки", delayed_report: "Повідомлення надійшло із затримкою" };
const labels: Record<string, string> = { "vfd.frequency_hz": "Вихідна частота", "vfd.set_frequency_hz": "Задана частота", "vfd.current_a": "Струм", "vfd.voltage_v": "Вихідна напруга", "pressure.bar": "Тиск", "water_level.percent": "Рівень води", pump_running: "Стан RUN частотника", vfd_fault_code: "Код помилки частотника", local_mode: "Ручний режим", emergency_stop: "Аварійна зупинка", vfd_link: "Зв’язок із частотником", vfd_configuration_valid: "Налаштування профілю перевірено", control_armed: "Локальний дозвіл керування" };
export function channelLabel(key: string): string { return Object.hasOwn(labels, key) ? labels[key]! : key; }
export function readingText(channel: Channel & Reading): string {
  if (channel.status === "missing" || channel.status === "invalid" || channel.value === null) return "—";
  if (typeof channel.value === "boolean") return channel.value ? "Так" : "Ні";
  return new Intl.NumberFormat("uk-UA", { maximumSignificantDigits: 15 }).format(channel.value);
}
