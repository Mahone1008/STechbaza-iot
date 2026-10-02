import { describe, expect, it } from "vitest";
import {
  calendarDate,
  calendarInputError,
  calendarMonthRows,
  clampCalendarDate,
  displayCalendarDate,
  isCalendarDate,
  readCalendarInput,
  shiftCalendarDays,
  shiftCalendarMonths,
} from "./calendar-date";

describe("calendar dates without browser timezone shifts", () => {
  it("validates leap years and rejects silently normalized or malformed dates", () => {
    expect(isCalendarDate("2000-02-29")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const value of ["2100-02-29", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "", "invalid"])
      expect(isCalendarDate(value)).toBe(false);
  });
  it("accepts local dates, eight digits and ISO paste without losing invalid drafts", () => {
    for (const value of ["02.10.2026", "02102026", "2026-10-02"]) expect(readCalendarInput(value)).toBe("2026-10-02");
    expect(displayCalendarDate("2026-10-02")).toBe("02.10.2026");
    expect(readCalendarInput("31022026")).toBe("31.02.2026");
    expect(readCalendarInput("02.")).toBe("02.");
    expect(displayCalendarDate("02.")).toBe("02.");
  });
  it("enforces required dates and inclusive range boundaries", () => {
    const min = "2026-10-02",
      max = "2027-01-31";
    expect(calendarInputError("", min, max)).toBe("Вкажіть дату.");
    expect(calendarInputError("", min, max, false)).toBe("");
    expect(calendarInputError("2026-10-01", min, max)).toContain("02.10.2026");
    expect(calendarInputError("2027-02-01", min, max)).toContain("31.01.2027");
    expect(calendarInputError(min, min, max)).toBe("");
    expect(calendarInputError(max, min, max)).toBe("");
    expect(clampCalendarDate("2025-01-01", min, max)).toBe(min);
    expect(clampCalendarDate("2028-01-01", min, max)).toBe(max);
  });
  it("uses the site's current day around UTC midnight", () => {
    const now = new Date("2026-10-01T22:30:00Z");
    expect(calendarDate(now, "Europe/Kyiv")).toBe("2026-10-02");
    expect(calendarDate(now, "America/Los_Angeles")).toBe("2026-10-01");
  });
  it("moves calendar days through DST and year changes without skipping dates", () => {
    expect(shiftCalendarDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftCalendarDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(shiftCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("clamps month and year navigation to the last valid day", () => {
    expect(shiftCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftCalendarMonths("2028-02-29", 12)).toBe("2029-02-28");
    expect(shiftCalendarMonths("2026-01-31", -1)).toBe("2025-12-31");
  });
  it("builds a Monday-first grid covering the whole month without duplicate days", () => {
    const rows = calendarMonthRows("2026-03-01"),
      days = rows.flat();
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    expect(days[0]).toBe("2026-02-23");
    expect(days.at(-1)).toBe("2026-04-05");
    expect(days.filter((day) => day.startsWith("2026-03"))).toHaveLength(31);
    expect(new Set(days).size).toBe(42);
  });
});
