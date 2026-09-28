import { describe, expect, it } from "vitest";
import { acknowledgedFixture, alarmFixture, alarmId, transitionFixture } from "../../../tests/fixtures/alarms";
import { inventoryTarget } from "../../features/inventory-context";
import { parseAcknowledgement, parseAlarm, parseAlarmPage, parseTransitions } from "./alarms";
const row = alarmFixture();
const org = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
const filters = { state: "active", severity: "", alarm_type: "" } as const;
describe("alarm read and acknowledgement contracts", () => {
  it("keeps zero context, active acknowledgement and resolved without acknowledgement distinct", () => {
    expect(parseAlarm(row, row.device_id).context.value).toBe(0);
    expect(parseAcknowledgement(acknowledgedFixture(), row.device_id, row.id).state).toBe("active");
    expect(parseAlarm(alarmFixture({ state: "resolved", resolved_at: "2026-09-28T12:01:00Z" }), row.device_id).acknowledged_at).toBeNull();
  });
  it("rejects foreign device, wrong alarm ID and inconsistent state/snapshot", () => {
    for (const change of [{ device_id: org }, { state: "resolved" }, { resolved_at: "2026-09-28T12:01:00Z" }, { acknowledged_by_email: "other@example.com" }, { state: "acknowledged" }]) expect(() => parseAlarm({ ...row, ...change }, row.device_id)).toThrow();
    expect(() => parseAlarm(row, row.device_id, org)).toThrow();
  });
  it("rejects malformed counters, enums, dates, nullable values and context", () => {
    for (const change of [{ occurrence_count: 0 }, { occurrence_count: 1.2 }, { occurrence_count: Number.MAX_SAFE_INTEGER + 1 }, { severity: "info" }, { updated_at: "bad" }, { description: {} }, { context: [] }, { acknowledged_at: undefined }, { last_event_id: "bad" }]) expect(() => parseAlarm({ ...row, ...change }, row.device_id)).toThrow();
  });
  it("checks list bounds, duplicates and exact server-side filters", () => {
    expect(parseAlarmPage([row], row.device_id, filters)).toEqual([row]);
    for (const rows of [[row, row], Array(22).fill(row)]) expect(() => parseAlarmPage(rows, row.device_id, filters)).toThrow();
    for (const filter of [{ ...filters, severity: "critical" as const }, { ...filters, state: "resolved" as const }, { ...filters, alarm_type: "other" }]) expect(() => parseAlarmPage([row], row.device_id, filter)).toThrow();
  });
  it("accepts first-actor idempotency even after concurrent resolution or deleted user FK", () => {
    const receipt = acknowledgedFixture({ acknowledged_by_user_id: null, acknowledged_by_display_name: "Інший оператор", state: "resolved", resolved_at: "2026-09-28T12:01:00Z" });
    expect(parseAcknowledgement(receipt, row.device_id, alarmId)).toEqual(receipt);
    expect(() => parseAcknowledgement(row, row.device_id, alarmId)).toThrow();
  });
  it("checks transition ownership, known type, actor tenant and bounded history", () => {
    const transition = transitionFixture();
    expect(parseTransitions([transition], alarmId, org)).toEqual([transition]);
    for (const change of [{ alarm_id: org }, { transition_type: "__proto__" }, { actor_organization_id: row.device_id }, { to_state: "closed" }, { data: null }, { actor_user_id: "invalid" }]) expect(() => parseTransitions([{ ...transition, ...change }], alarmId, org)).toThrow();
    expect(() => parseTransitions([transition, transition], alarmId, org)).toThrow();
    expect(() => parseTransitions(Array(22).fill(transition), alarmId, org)).toThrow();
  });
  it("resolves alarm deep links to the device before rendering and rejects malformed identifiers", () => {
    expect(inventoryTarget(`/alarms/devices/${row.device_id}/${alarmId}`)).toEqual({ deviceId: row.device_id });
    expect(inventoryTarget(`/alarms/devices/${row.device_id}`)).toEqual({ deviceId: row.device_id });
    for (const path of ["/alarms/devices/not-a-uuid", `/alarms/devices/${row.device_id}/bad`, `/alarms/devices/${row.device_id}/${alarmId}/extra`]) expect(inventoryTarget(path)).toEqual({ invalid: true });
  });
});
