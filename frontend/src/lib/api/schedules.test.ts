import { describe, expect, it } from "vitest";
import { calendarDate, formatScheduleTime, newScheduleSpec, parseScheduleRun, parseSchedules, parseScheduleSpec } from "./schedules";

const rule = { ...newScheduleSpec("Europe/Kyiv", "2076-02-29"), name: "Полив", frequency_hz: 40 };
const id = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d2";
const org = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d3";
const device = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d4";
const row = { id, device_id: device, organization_id: org, revision: 1, enabled: true, spec: rule, next_start_at: "2076-02-29T17:00:00Z", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z" };
describe("calendar API boundaries", () => {
  it("uses the object's date across midnight independently of browser timezone", () => {
    expect(calendarDate(new Date("2026-12-31T23:30:00Z"), "Europe/Kyiv")).toBe("2027-01-01");
    expect(calendarDate(new Date("2026-12-31T23:30:00Z"), "America/New_York")).toBe("2026-12-31");
  });
  it("accepts future calendar rules without 32-bit timestamps", () => {
    expect(parseScheduleSpec(rule)).toEqual(rule);
    expect(parseSchedules([row], device, org)).toEqual([row]);
    expect(formatScheduleTime(row.next_start_at, "Europe/Kyiv")).toContain("29.02.2076");
  });
  it("rejects cross-tenant, duplicate and malformed records", () => {
    expect(() => parseSchedules([row], device, device)).toThrow();
    expect(() => parseSchedules([row, row], device, org)).toThrow();
    expect(() => parseSchedules([{ ...row, revision: 1.5 }], device, org)).toThrow();
    expect(() => parseScheduleSpec({ ...rule, timezone: "Moon/Base" })).toThrow();
    expect(() => parseScheduleSpec({ ...rule, start_date: "2077-02-29" })).toThrow();
    expect(() => parseScheduleSpec({ ...rule, changes: [{ at: "28:00", day_offset: 0, frequency_hz: 40 }] })).toThrow();
  });
  it("accepts only steps that exactly cover the fixed calendar window", () => {
    const run = { version: 1, starts_at: "2076-02-29T17:00:00Z", stops_at: "2076-02-29T17:02:00Z", steps: [{ frequency_hz: 40, duration_seconds: 120 }] };
    expect(parseScheduleRun(run)).toEqual(run);
    expect(parseScheduleRun({ ...run, stops_at: "2076-02-29T17:03:00Z" })).toBeNull();
    expect(parseScheduleRun({ ...run, injected: true })).toBeNull();
    expect(parseScheduleRun({ ...run, starts_at: "2076-02-29T17:00:00", stops_at: "2076-02-29T17:02:00" })).toBeNull();
  });
  it("accepts a full week and rejects invalid day offsets and excess duration", () => {
    expect(parseScheduleSpec({ ...rule, stop_day_offset: 7, changes: [{ at: "12:00", day_offset: 3, frequency_hz: 30 }] }).stop_day_offset).toBe(7);
    for (const offset of [8, -1, 1.5, true, "7"]) {
      expect(() => parseScheduleSpec({ ...rule, stop_day_offset: offset })).toThrow();
      expect(() => parseScheduleSpec({ ...rule, changes: [{ at: "12:00", day_offset: offset, frequency_hz: 30 }] })).toThrow();
    }
    const week = { version: 1, starts_at: "2076-02-29T17:00:00Z", stops_at: "2076-03-07T17:00:00Z", steps: [{ frequency_hz: 40, duration_seconds: 604800 }] };
    expect(parseScheduleRun(week)).toEqual(week);
    expect(parseScheduleRun({ ...week, stops_at: "2076-03-07T17:00:01Z", steps: [{ frequency_hz: 40, duration_seconds: 604801 }] })).toBeNull();
  });
});
