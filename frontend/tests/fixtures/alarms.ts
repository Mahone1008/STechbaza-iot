import type { Alarm, AlarmTransition } from "../../src/lib/api/alarms";
export const alarmId = "e8f2f2d6-e380-492a-a9dc-d0b9ba792136";
export function alarmFixture(changes: Partial<Alarm> = {}): Alarm {
  return {
    id: alarmId, device_id: "a8f2f2d6-e380-492a-a9dc-d0b9ba792136", alarm_key: "demo.pressure.low:pressure.bar", alarm_type: "demo.pressure.low",
    severity: "warning", state: "active", title: "Низький тиск", description: "Перевірте водозабір.",
    first_raised_at: "2026-09-28T12:00:00.000000Z", last_raised_at: "2026-09-28T12:00:10.000000Z", resolved_at: null,
    acknowledged_at: null, acknowledged_by_user_id: null, acknowledged_by_email: null, acknowledged_by_display_name: null,
    last_event_id: null, occurrence_count: 2, context: { metric: "pressure.bar", value: 0 },
    created_at: "2026-09-28T12:00:00.000000Z", updated_at: "2026-09-28T12:00:10.000000Z", ...changes,
  };
}
export function acknowledgedFixture(changes: Partial<Alarm> = {}) {
  return alarmFixture({ acknowledged_at: "2026-09-28T12:00:15Z", acknowledged_by_user_id: "0f4ac4a8-6a1d-4d4b-9f91-4c9d5d1a8b31", acknowledged_by_email: "owner@example.com", acknowledged_by_display_name: "Оператор тесту", ...changes });
}
export function transitionFixture(changes: Partial<AlarmTransition> = {}): AlarmTransition {
  return { id: "f8f2f2d6-e380-492a-a9dc-d0b9ba792136", alarm_id: alarmId, event_id: null, transition_type: "raised", from_state: null, to_state: "active", occurred_at: "2026-09-28T12:00:00Z", actor_user_id: null, actor_auth_session_id: null, actor_organization_id: null, actor_organization_role: null, actor_email: null, actor_display_name: null, reason: null, data: { severity: "warning" }, ...changes };
}
