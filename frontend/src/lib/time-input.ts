export function normalizeTimeInput(value: string, complete = true): string {
  const input = value.trim();
  const parts =
    /^(\d{1,2}):(\d{2})(?::00)?$/.exec(input) ?? (complete ? /^(\d{1,2})(\d{2})$/ : /^(\d{2})(\d{2})$/).exec(input);
  if (!parts || Number(parts[1]) > 23 || Number(parts[2]) > 59) return value;
  return `${parts[1]!.padStart(2, "0")}:${parts[2]}`;
}

export function timeInputError(value: string): string {
  if (!value) return "Вкажіть час.";
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizeTimeInput(value))
    ? ""
    : "Вкажіть час від 00:00 до 23:59, наприклад 6:00 або 06:00.";
}

export function minuteOfDay(value: string): number | null {
  if (timeInputError(value)) return null;
  const [hours, minutes] = normalizeTimeInput(value).split(":").map(Number);
  return hours! * 60 + minutes!;
}
