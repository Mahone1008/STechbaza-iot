import type { Notification } from "../../src/lib/api/notifications";
import { alarmFixture } from "./alarms";
export const notificationId = "18f2f2d6-e380-492a-a9dc-d0b9ba792136";
export const organizationId = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
export function notificationFixture(overrides: Partial<Notification> = {}): Notification {
  const alarm = alarmFixture();
  return { id: notificationId, organization_id: organizationId, device_id: alarm.device_id, alarm_id: alarm.id,
    transition_id: "28f2f2d6-e380-492a-a9dc-d0b9ba792136", kind: "raised", severity: "warning",
    title: "Низький тиск", description: "Перевірте тиск на об’єкті.", occurred_at: "2026-09-28T12:00:00Z", created_at: "2026-09-28T12:00:01Z", read_at: null, ...overrides };
}
