import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import { MAX_SCHEDULE_DAYS, MAX_SCHEDULE_SECONDS, parseProgramPlan } from "./programs";
import type { components } from "./schema";
export { calendarDate } from "../calendar-date";

export type Schedule = components["schemas"]["ScheduleRead"];
export type ScheduleSpec = Required<components["schemas"]["ScheduleSpec"]>;
export type ScheduleWrite = components["schemas"]["ScheduleWrite"];
export type SchedulePreview = components["schemas"]["SchedulePreview"];
export type ScheduleRun = components["schemas"]["ScheduleRun"];
export type ScheduleOccurrence = components["schemas"]["ScheduleOccurrenceRead"];
export const scheduleDayLabels = ["Того самого дня", "Наступного дня", "Через 2 дні", "Через 3 дні", "Через 4 дні", "Через 5 днів", "Через 6 днів", "Через 7 днів"] as const;
const dayOffset = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SCHEDULE_DAYS;
const path = "/api/v1/devices/schedules";
export const repeatLabels = { once: "Один раз", daily: "Щодня", weekly: "За днями тижня", interval: "Кожні N днів", monthly: "Щомісяця", yearly: "Щороку" } as const;
const isoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const localTime = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value);
const zonedSecond = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.0+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const hz = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
const scheduleFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatScheduleTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Некоректна дата";
  try {
    let formatter = scheduleFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("uk-UA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      if (scheduleFormatters.size >= 8) scheduleFormatters.delete(scheduleFormatters.keys().next().value!);
      scheduleFormatters.set(timezone, formatter);
    }
    return formatter.format(date);
  } catch {
    return `${date.toISOString()} (UTC)`;
  }
}

export function newScheduleSpec(timezone: string, today: string): ScheduleSpec {
  return { name: "", timezone, start_date: today, until_date: today, start_time: "19:00", stop_time: "02:00", stop_day_offset: 1,
    frequency_hz: 0, repeat: "once", weekdays: [], interval_days: 1, month_day: 1, months: Array.from({ length: 12 }, (_, index) => index + 1), excluded_dates: [], changes: [] };
}
export function parseScheduleSpec(raw: unknown): ScheduleSpec {
  if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.timezone !== "string" || !isoDay(raw.start_date) || !isoDay(raw.until_date)
    || !localTime(raw.start_time) || !localTime(raw.stop_time) || !dayOffset(raw.stop_day_offset) || !hz(raw.frequency_hz)
    || typeof raw.repeat !== "string" || !Object.hasOwn(repeatLabels, raw.repeat)) invalidResponse(path, "schedule rule");
  try { new Intl.DateTimeFormat("uk-UA", { timeZone: raw.timezone }).format(); } catch { invalidResponse(path, "schedule timezone"); }
  for (const [key, min, max] of [["weekdays", 0, 6], ["months", 1, 12]] as const) {
    const values = raw[key];
    if (!Array.isArray(values) || values.length > max - min + 1 || new Set(values).size !== values.length || values.some((value) => !Number.isInteger(value) || value < min || value > max)) invalidResponse(path, key);
  }
  if (!Number.isInteger(raw.interval_days) || Number(raw.interval_days) < 1 || Number(raw.interval_days) > 366 || !Number.isInteger(raw.month_day) || Number(raw.month_day) < -1 || Number(raw.month_day) === 0 || Number(raw.month_day) > 31) invalidResponse(path, "schedule interval");
  if (!Array.isArray(raw.excluded_dates) || raw.excluded_dates.length > 100 || raw.excluded_dates.some((value) => !isoDay(value))) invalidResponse(path, "schedule exclusions");
  if (!Array.isArray(raw.changes) || raw.changes.length > 7 || raw.changes.some((value) => !isRecord(value) || !localTime(value.at) || !dayOffset(value.day_offset) || !hz(value.frequency_hz))) invalidResponse(path, "schedule frequency changes");
  return raw as ScheduleSpec;
}
export function parseSchedule(raw: unknown, deviceId: string, organizationId: string): Schedule {
  if (!isRecord(raw)) invalidResponse(path, "schedule");
  for (const field of ["id", "device_id", "organization_id"]) requiredUuid(raw, field, path);
  if (raw.device_id !== deviceId || raw.organization_id !== organizationId) invalidResponse(path, "schedule scope");
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || typeof raw.enabled !== "boolean") invalidResponse(path, "schedule revision");
  for (const field of ["created_at", "updated_at"]) requiredDateTime(raw, field, path);
  if (raw.next_start_at !== null) requiredDateTime(raw, "next_start_at", path);
  parseScheduleSpec(raw.spec);
  return raw as Schedule;
}
export function parseSchedules(raw: unknown, deviceId: string, organizationId: string): Schedule[] {
  if (!Array.isArray(raw) || raw.length > 50) invalidResponse(path, "schedule list");
  const rows = raw.map((row) => parseSchedule(row, deviceId, organizationId));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) invalidResponse(path, "duplicate schedule");
  return rows;
}
export function parseScheduleRun(raw: unknown): ScheduleRun | null {
  if (!isRecord(raw) || Object.keys(raw).length !== 4 || typeof raw.starts_at !== "string" || typeof raw.stops_at !== "string") return null;
  if (![raw.starts_at, raw.stops_at].every((value) => zonedSecond.test(value) && isoDay(value.slice(0, 10)))) return null;
  try { requiredDateTime(raw, "starts_at", path); requiredDateTime(raw, "stops_at", path); } catch { return null; }
  const plan = parseProgramPlan({ version: raw.version, steps: raw.steps }, MAX_SCHEDULE_SECONDS);
  if (!plan || !Number.isFinite(Date.parse(raw.starts_at)) || !Number.isFinite(Date.parse(raw.stops_at)) || Date.parse(raw.stops_at) - Date.parse(raw.starts_at) !== plan.steps.reduce((sum, step) => sum + step.duration_seconds, 0) * 1000) return null;
  return { ...plan, starts_at: raw.starts_at, stops_at: raw.stops_at };
}
export function parseSchedulePreview(raw: unknown): SchedulePreview {
  if (!isRecord(raw) || !Array.isArray(raw.runs) || raw.runs.length > 5 || raw.runs.some((run) => !parseScheduleRun(run))
    || !Array.isArray(raw.conflicts) || raw.conflicts.length > 50 || !Array.isArray(raw.notes) || raw.notes.some((note) => typeof note !== "string") || raw.conflict_horizon_days !== 366) invalidResponse(path, "schedule preview");
  for (const value of raw.conflicts) requiredUuid({ id: value }, "id", path);
  return raw as SchedulePreview;
}
export function parseScheduleHistory(raw: unknown, scheduleId: string): ScheduleOccurrence[] {
  if (!Array.isArray(raw) || raw.length > 30) invalidResponse(path, "schedule history");
  return raw.map((row) => {
    if (!isRecord(row) || row.schedule_id !== scheduleId || !Number.isInteger(row.revision)) invalidResponse(path, "schedule occurrence");
    for (const field of ["id", "schedule_id"]) requiredUuid(row, field, path);
    for (const field of ["starts_at", "stops_at", "created_at"]) requiredDateTime(row, field, path);
    if (row.command_id !== null) requiredUuid(row, "command_id", path);
    requiredString(row, "status", path);
    if (row.reason !== null && typeof row.reason !== "string") invalidResponse(path, "schedule reason");
    return row as ScheduleOccurrence;
  });
}
