export const MIN_CALENDAR_DATE = "2000-01-01";
export const MAX_CALENDAR_DATE = "2199-12-31";

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function calendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)!.value).join("-");
}

export function displayCalendarDate(value: string): string {
  return isCalendarDate(value) ? value.split("-").reverse().join(".") : value;
}

export function readCalendarInput(value: string): string {
  const formatted = value.replace(/^(\d{2})(\d{2})(\d{4})$/, "$1.$2.$3");
  const iso = /^\d{2}\.\d{2}\.\d{4}$/.test(formatted) ? formatted.split(".").reverse().join("-") : formatted;
  return isCalendarDate(iso) ? iso : formatted;
}

export function clampCalendarDate(value: string, min: string, max: string): string {
  return value < min ? min : value > max ? max : value;
}

export function calendarInputError(value: string, min: string, max: string, required = true): string {
  if (!value) return required ? "Вкажіть дату." : "";
  if (!isCalendarDate(value)) return "Вкажіть дійсну дату у форматі ДД.ММ.РРРР.";
  if (value < min) return `Дата має бути не раніше ${displayCalendarDate(min)}.`;
  if (value > max) return `Дата має бути не пізніше ${displayCalendarDate(max)}.`;
  return "";
}

// Календарна арифметика не залежить від часового поясу браузера та переходів DST.
export function shiftCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftCalendarMonths(value: string, months: number): string {
  const date = new Date(`${value}T12:00:00Z`),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function calendarMonthRows(value: string): string[][] {
  const first = `${value.slice(0, 7)}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftCalendarDays(first, -offset);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => shiftCalendarDays(start, week * 7 + day)),
  );
}
