import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import { matchingId, parsePage } from "./inventory";
import type { components } from "./schema";

export type Notification = components["schemas"]["AlarmNotificationRead"];
export const notificationKindLabels: Record<Notification["kind"], string> = {
  raised: "Виникла аварія", severity_changed: "Змінено важливість", resolved: "Причину усунено",
};
const path = "/api/v1/notifications";

export function parseNotification(raw: unknown, organizationId: string, id?: string): Notification {
  if (!isRecord(raw)) invalidResponse(path, "AlarmNotificationRead");
  const actualId = requiredUuid(raw, "id", path);
  if (id) matchingId(actualId, id, path);
  matchingId(requiredUuid(raw, "organization_id", path), organizationId, path);
  for (const key of ["device_id", "alarm_id", "transition_id"]) requiredUuid(raw, key, path);
  requiredString(raw, "title", path);
  if (raw.description !== null && typeof raw.description !== "string") invalidResponse(path, "description");
  if (typeof raw.kind !== "string" || !Object.hasOwn(notificationKindLabels, raw.kind)) invalidResponse(path, "kind");
  if (raw.severity !== "warning" && raw.severity !== "critical") invalidResponse(path, "severity");
  for (const key of ["occurred_at", "created_at"]) requiredDateTime(raw, key, path);
  if (raw.read_at !== null) requiredDateTime(raw, "read_at", path);
  return raw as Notification;
}

export function parseNotificationPage(raw: unknown, organizationId: string, unreadOnly: boolean): Notification[] {
  const rows = parsePage(raw, (item) => parseNotification(item, organizationId));
  if (unreadOnly && rows.some((row) => row.read_at !== null)) invalidResponse(path, "unread filter");
  return rows;
}

export function parseUnreadCount(raw: unknown): number {
  if (!isRecord(raw) || typeof raw.unread_count !== "number" || !Number.isSafeInteger(raw.unread_count) || raw.unread_count < 0) invalidResponse(path, "unread_count");
  return raw.unread_count;
}

export function parseReadReceipt(raw: unknown, id: string): string {
  if (!isRecord(raw)) invalidResponse(path, "NotificationReadReceipt");
  matchingId(requiredUuid(raw, "notification_id", path), id, path);
  return requiredDateTime(raw, "read_at", path);
}
