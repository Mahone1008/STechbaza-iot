import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import { matchingId, parsePage } from "./inventory";
import type { components } from "./schema";

export type Alarm = components["schemas"]["DeviceAlarmRead"];
export type AlarmTransition = components["schemas"]["AlarmTransitionRead"];
export type AlarmFilters = { state: "" | Alarm["state"]; severity: "" | Alarm["severity"]; alarm_type: string };
export const alarmSeverityLabels = { warning: "Попередження", critical: "Критична" } as const;
export const alarmStateLabels = { active: "Активна", resolved: "Усунена" } as const;
export const transitionLabels: Record<AlarmTransition["transition_type"], string> = {
  raised: "Виникла", repeated: "Повторення", acknowledged: "Підтверджена оператором",
  resolved: "Усунена", reopened: "Відкрита повторно", severity_changed: "Змінено важливість",
};
const path = "/api/v1/alarms";
function nullable(record: Record<string, unknown>, key: string, read: typeof requiredString) {
  return record[key] === null ? null : read(record, key, path);
}
function nullableText(record: Record<string, unknown>, key: string) {
  if (record[key] !== null && typeof record[key] !== "string") invalidResponse(path, key);
}

export function parseAlarm(raw: unknown, deviceId: string, alarmId?: string): Alarm {
  if (!isRecord(raw)) invalidResponse(path, "DeviceAlarmRead");
  const id = requiredUuid(raw, "id", path);
  if (alarmId) matchingId(id, alarmId, path);
  matchingId(requiredUuid(raw, "device_id", path), deviceId, path);
  for (const key of ["alarm_key", "alarm_type", "title"]) requiredString(raw, key, path);
  if (raw.state !== "active" && raw.state !== "resolved") invalidResponse(path, "state");
  if (raw.severity !== "warning" && raw.severity !== "critical") invalidResponse(path, "severity");
  for (const key of ["first_raised_at", "last_raised_at", "created_at", "updated_at"]) requiredDateTime(raw, key, path);
  const resolved = nullable(raw, "resolved_at", requiredDateTime);
  const acknowledged = nullable(raw, "acknowledged_at", requiredDateTime);
  const actor = nullable(raw, "acknowledged_by_user_id", requiredUuid);
  nullable(raw, "last_event_id", requiredUuid);
  for (const key of ["description", "acknowledged_by_email", "acknowledged_by_display_name"]) nullableText(raw, key);
  if ((raw.state === "resolved") !== (resolved !== null)) invalidResponse(path, "resolved state/time");
  // FK автора може стати null після видалення користувача; snapshot лишається.
  if (!acknowledged && (actor !== null || raw.acknowledged_by_email !== null || raw.acknowledged_by_display_name !== null)) invalidResponse(path, "acknowledgement snapshot");
  if (typeof raw.occurrence_count !== "number" || !Number.isSafeInteger(raw.occurrence_count) || raw.occurrence_count < 1 || !isRecord(raw.context)) invalidResponse(path, "count/context");
  return raw as Alarm;
}

export function parseAlarmPage(raw: unknown, deviceId: string, filters: AlarmFilters): Alarm[] {
  const rows = parsePage(raw, (item) => parseAlarm(item, deviceId));
  for (const row of rows) {
    if ((filters.state && row.state !== filters.state) || (filters.severity && row.severity !== filters.severity) || (filters.alarm_type && row.alarm_type !== filters.alarm_type)) invalidResponse(path, "matching filters");
  }
  return rows;
}

export function parseTransitions(raw: unknown, alarmId: string, organizationId: string): AlarmTransition[] {
  return parsePage(raw, (item) => {
    if (!isRecord(item)) invalidResponse(path, "AlarmTransitionRead");
    requiredUuid(item, "id", path);
    matchingId(requiredUuid(item, "alarm_id", path), alarmId, path);
    if (typeof item.transition_type !== "string" || !Object.hasOwn(transitionLabels, item.transition_type)) invalidResponse(path, "transition_type");
    for (const key of ["from_state", "to_state"]) if (item[key] !== null && item[key] !== "active" && item[key] !== "resolved") invalidResponse(path, key);
    requiredDateTime(item, "occurred_at", path);
    for (const key of ["event_id", "actor_user_id", "actor_auth_session_id"]) nullable(item, key, requiredUuid);
    const organization = nullable(item, "actor_organization_id", requiredUuid);
    if (organization) matchingId(organization, organizationId, path);
    for (const key of ["actor_organization_role", "actor_email", "actor_display_name", "reason"]) nullableText(item, key);
    if (!isRecord(item.data)) invalidResponse(path, "transition data");
    return item as AlarmTransition;
  });
}

export function parseAcknowledgement(raw: unknown, deviceId: string, alarmId: string): Alarm {
  const alarm = parseAlarm(raw, deviceId, alarmId);
  if (!alarm.acknowledged_at) invalidResponse(path, "acknowledged receipt");
  // Інший оператор міг підтвердити першим: його авторство не підміняємо.
  return alarm;
}
