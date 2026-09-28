import { describe, expect, it } from "vitest";
import { apiQueryKeys } from "./query-keys";
import { formatSeen, mapBounded, parseAvailability, parseDevice, parsePage, parseSite } from "./inventory";
import { inventoryTarget } from "@/features/inventory-context";

const org = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
const siteId = "739512a9-6ddb-4f8e-99e9-211c8553651e";
const id = "a8f2f2d6-e380-492a-a9dc-d0b9ba792136";
const dates = { created_at: "2026-09-27T12:00:00Z", updated_at: "2026-09-27T12:00:00Z" };
const site = { id: siteId, organization_id: org, name: "Об’єкт", code: "A", timezone: "Europe/Kyiv", ...dates };
const device = { id, site_id: siteId, name: "Контролер", uid: "TB-TEST", device_type: "controller", lifecycle_status: "active", last_seen_at: null, ...dates };
const presence = { device_id: id, uid: device.uid, online: false, last_seen_at: null, timeout_seconds: 90, seconds_since_seen: null };

describe("inventory response boundaries", () => {
  it("rejects mismatched parents and malformed IDs before rendering", () => {
    expect(parseSite(site, org, siteId)).toEqual(site);
    expect(parseDevice(device, siteId, id)).toEqual(device);
    expect(() => parseSite(site, id)).toThrow();
    expect(() => parseDevice(device, org)).toThrow();
    expect(() => parseDevice({ ...device, id: "north-pump" })).toThrow();
    expect(() => parseDevice({ ...device, last_seen_at: "yesterday" })).toThrow();
  });
  it("bounds page size and rejects duplicated rows", () => {
    expect(parsePage([], parseDevice)).toEqual([]);
    expect(() => parsePage([device, device], parseDevice)).toThrow();
    expect(() => parsePage(Array(22).fill(device), parseDevice)).toThrow();
  });
  it("keeps presence separate from lifecycle and rejects incoherent responses", () => {
    expect(parseAvailability(presence, device)).toEqual(presence);
    expect(() => parseAvailability({ ...presence, device_id: org }, device)).toThrow();
    expect(() => parseAvailability({ ...presence, uid: "OTHER" }, device)).toThrow();
    expect(() => parseAvailability({ ...presence, online: true }, device)).toThrow();
    expect(() => parseAvailability({ ...presence, seconds_since_seen: -1 }, device)).toThrow();
    expect(() => parseAvailability({ ...presence, timeout_seconds: Infinity }, device)).toThrow();
  });
  it("preserves deep-link ancestry and rejects fixture slugs", () => {
    expect(inventoryTarget(`/organizations/${org}/sites/${siteId}/devices`)).toEqual({ organizationId: org, siteId });
    expect(inventoryTarget(`/devices/${id}`)).toEqual({ deviceId: id });
    expect(inventoryTarget("/devices/north-pump")).toEqual({ invalid: true });
    expect(inventoryTarget("/organizations/invalid/sites")).toEqual({ invalid: true });
  });
  it("isolates cached pages across users, sessions, tenants and sites", () => {
    const scope = { userId: "a", sessionId: "s" };
    const base = apiQueryKeys.inventory(scope, org, siteId, "devices", 0);
    const alternatives = [
      apiQueryKeys.inventory({ ...scope, userId: "b" }, org, siteId, "devices", 0),
      apiQueryKeys.inventory({ ...scope, sessionId: "t" }, org, siteId, "devices", 0),
      apiQueryKeys.inventory(scope, id, siteId, "devices", 0),
      apiQueryKeys.inventory(scope, org, id, "devices", 0),
      apiQueryKeys.inventory(scope, org, siteId, "devices", 1),
    ];
    alternatives.forEach((key) => expect(key).not.toEqual(base));
  });
  it("uses a safe UTC fallback for unsupported site timezones", () => {
    expect(formatSeen(null, "invalid")).toBe("Ще не було зв’язку");
    expect(formatSeen(dates.created_at, "invalid")).toBe("2026-09-27T12:00:00.000Z (UTC)");
  });
});

describe("bounded presence queue", () => {
  it("limits active calls and preserves row order", async () => {
    let active = 0;
    let maximum = 0;
    const result = await mapBounded([0, 1, 2, 3, 4, 5, 6], 4, new AbortController().signal, async (value) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });
    expect(maximum).toBe(4);
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });
  it("does not schedule queued calls after navigation aborts", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const release: (() => void)[] = [];
    const run = mapBounded([0, 1, 2, 3, 4, 5], 4, controller.signal, async (value) => {
      started.push(value);
      await new Promise<void>((resolve) => release.push(resolve));
      return value;
    });
    const result = expect(run).rejects.toThrow();
    expect(started).toEqual([0, 1, 2, 3]);
    controller.abort();
    release.forEach((resolve) => resolve());
    await result;
    expect(started).toEqual([0, 1, 2, 3]);
  });
});
