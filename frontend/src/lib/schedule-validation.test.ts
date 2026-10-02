import { describe, expect, it } from "vitest";
import { newScheduleSpec } from "./api/schedules";
import { normalizeScheduleTimes, scheduleTimingErrors } from "./schedule-validation";
import { minuteOfDay, normalizeTimeInput, timeInputError } from "./time-input";

describe("schedule input and chronological boundaries", () => {
  it("accepts short hours and compact input without completing three digits during typing", () => {
    for (const value of ["6:00", "06:00", "600", "0600", "06:00:00"]) {
      expect(normalizeTimeInput(value)).toBe("06:00");
      expect(timeInputError(value)).toBe("");
      expect(minuteOfDay(value)).toBe(360);
    }
    expect(normalizeTimeInput("123", false)).toBe("123");
    expect(normalizeTimeInput("1234", false)).toBe("12:34");
  });
  it("rejects impossible or incomplete times without silently changing their meaning", () => {
    for (const value of ["", "24:00", "23:60", "6:0", "40", "1260", "06:00:01"]) {
      expect(timeInputError(value)).not.toBe("");
      expect(minuteOfDay(value)).toBeNull();
    }
  });
  it("explains a next-day change after the same-day stop from the operator screenshot", () => {
    const spec = {
      ...newScheduleSpec("Europe/Kyiv", "2026-10-02"),
      stop_time: "19:30",
      stop_day_offset: 0,
      changes: [{ at: "6:00", day_offset: 1, frequency_hz: 40 }],
    };
    expect(scheduleTimingErrors(spec).changes[0]).toContain("06:00 (наступного дня)");
    expect(scheduleTimingErrors(spec).changes[0]).toContain("19:30 (того самого дня)");
    expect(
      scheduleTimingErrors({ ...spec, changes: [{ ...spec.changes[0]!, at: "19:15", day_offset: 0 }] }).changes,
    ).toEqual([""]);
  });
  it("allows exact one-minute gaps but rejects equal and reversed transitions", () => {
    const spec = {
      ...newScheduleSpec("Europe/Kyiv", "2026-10-02"),
      stop_time: "19:03",
      stop_day_offset: 0,
      changes: [
        { at: "19:01", day_offset: 0, frequency_hz: 40 },
        { at: "19:02", day_offset: 0, frequency_hz: 45 },
      ],
    };
    expect(scheduleTimingErrors(spec)).toEqual({ stop: "", changes: ["", ""] });
    for (const at of ["19:00", "19:01", "19:03"]) {
      expect(
        scheduleTimingErrors({ ...spec, changes: [spec.changes[0]!, { ...spec.changes[1]!, at }] }).changes[1],
      ).not.toBe("");
    }
  });
  it("validates midnight, one-minute and seven-day run boundaries", () => {
    const spec = {
      ...newScheduleSpec("Europe/Kyiv", "2026-10-02"),
      start_time: "23:59",
      stop_time: "0:00",
      stop_day_offset: 1,
    };
    expect(scheduleTimingErrors(spec).stop).toBe("");
    expect(scheduleTimingErrors({ ...spec, stop_day_offset: 0 }).stop).not.toBe("");
    expect(scheduleTimingErrors({ ...spec, start_time: "19:00", stop_time: "19:00", stop_day_offset: 7 }).stop).toBe(
      "",
    );
    expect(
      scheduleTimingErrors({ ...spec, start_time: "19:00", stop_time: "19:01", stop_day_offset: 7 }).stop,
    ).not.toBe("");
  });
  it("normalizes the preview payload without mutating the draft or day offsets", () => {
    const spec = {
      ...newScheduleSpec("Europe/Kyiv", "2026-10-02"),
      start_time: "600",
      stop_time: "7:00",
      changes: [{ at: "630", day_offset: 1, frequency_hz: 40 }],
    };
    expect(normalizeScheduleTimes(spec)).toMatchObject({
      start_time: "06:00",
      stop_time: "07:00",
      changes: [{ at: "06:30", day_offset: 1 }],
    });
    expect(spec.start_time).toBe("600");
  });
});
