import { describe, expect, it } from "vitest";
import { notificationFixture, notificationId, organizationId } from "../../../tests/fixtures/notifications";
import { inventoryTarget } from "../../features/inventory-context";
import { parseNotification, parseNotificationPage, parseReadReceipt, parseUnreadCount } from "./notifications";
import { apiQueryKeys } from "./query-keys";
const row = notificationFixture();
describe("personal notification contracts", () => {
  it("keeps immutable event kind and personal read separate", () => {
    expect(parseNotification(row, organizationId)).toEqual(row);
    expect(parseNotification(notificationFixture({ kind: "resolved", read_at: row.created_at }), organizationId).kind).toBe("resolved");
  });
  it("rejects foreign organization and mismatched notification identity", () => {
    expect(() => parseNotification(row, row.device_id)).toThrow();
    expect(() => parseNotification(row, organizationId, row.device_id)).toThrow();
  });
  it("validates all linked IDs, timestamps, snapshots and enums", () => {
    for (const change of [{ device_id: "bad" }, { alarm_id: null }, { transition_id: "bad" }, { kind: "__proto__" }, { severity: "info" }, { read_at: undefined }, { created_at: "bad" }, { occurred_at: "bad" }, { description: {} }, { title: "" }]) expect(() => parseNotification({ ...row, ...change }, organizationId)).toThrow();
  });
  it("bounds pages, rejects duplicate IDs and checks the unread filter", () => {
    expect(parseNotificationPage([], organizationId, true)).toEqual([]);
    for (const rows of [[row, row], Array(22).fill(row), [notificationFixture({ read_at: row.created_at })]]) expect(() => parseNotificationPage(rows, organizationId, true)).toThrow();
  });
  it("accepts zero but rejects invalid counts instead of replacing them with zero", () => {
    expect(parseUnreadCount({ unread_count: 0 })).toBe(0);
    for (const count of [-1, 1.1, "1", null, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => parseUnreadCount({ unread_count: count })).toThrow();
  });
  it("requires exact receipt ID and a valid first-read timestamp", () => {
    expect(parseReadReceipt({ notification_id: row.id, read_at: row.created_at }, row.id)).toBe(row.created_at);
    for (const raw of [{ notification_id: row.device_id, read_at: row.created_at }, { notification_id: row.id, read_at: null }]) expect(() => parseReadReceipt(raw, row.id)).toThrow();
  });
  it("routes explicit tenant links and refuses malformed paths", () => {
    expect(inventoryTarget(`/organizations/${organizationId}/notifications/${notificationId}`)).toEqual({ organizationId });
    expect(inventoryTarget(`/organizations/${organizationId}/notifications`)).toEqual({ organizationId });
    for (const path of ["/organizations/bad/notifications", `/organizations/${organizationId}/notifications/bad`, `/organizations/${organizationId}/notifications/${notificationId}/extra`, "/notifications/bad"]) expect(inventoryTarget(path)).toEqual({ invalid: true });
  });
  it("isolates cache by reader, session and organization", () => {
    const scope = { userId: "one", sessionId: "session" };
    const key = apiQueryKeys.notification(scope, organizationId, row.id);
    expect(apiQueryKeys.notification({ ...scope, userId: "two" }, organizationId, row.id)).not.toEqual(key);
    expect(apiQueryKeys.notification({ ...scope, sessionId: "other" }, organizationId, row.id)).not.toEqual(key);
    expect(apiQueryKeys.notification(scope, row.device_id, row.id)).not.toEqual(key);
  });
});
