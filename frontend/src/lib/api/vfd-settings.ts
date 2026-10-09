import { invalidResponse, isRecord } from "./access";
import type { components } from "./schema";

export type VfdSettings = components["schemas"]["VfdSettings"];
const path = "/api/v1/devices/overview";
const word = (value: unknown, max: number) =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);

export function parseVfdSettings(raw: unknown): VfdSettings | null {
  if (raw === undefined || raw === null) return null;
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    raw.driver_id !== "su600" ||
    typeof raw.ready !== "boolean" ||
    typeof raw.command_sequence !== "number" ||
    !Number.isSafeInteger(raw.command_sequence) ||
    raw.command_sequence < 0 ||
    !word(raw.run_source, 2) ||
    !word(raw.frequency_source, 7) ||
    !isRecord(raw.parameters) ||
    Object.keys(raw.parameters).some((code) => !["F0.10", "F0.11"].includes(code)) ||
    !["F0.10", "F0.11"].every((code) => word((raw.parameters as Record<string, unknown>)[code], 9999))
  )
    invalidResponse(path, "model-specific VFD settings");
  return raw as VfdSettings;
}

export function sourceLabel(settings: VfdSettings | null | undefined): string {
  if (!settings || settings.run_source === null || settings.frequency_source === null) return "Не підтверджено";
  if (settings.run_source === 2 && settings.frequency_source === 6) return "Дистанційне";
  if (settings.run_source === 0 && settings.frequency_source === 0) return "Місцеве · крутилка панелі";
  if (settings.run_source === 0 && settings.frequency_source === 1) return "Місцеве · кнопки панелі";
  if (settings.run_source === 1) return "Місцеве · клеми установки";
  return "Джерела запуску та частоти відрізняються";
}

export function parameterWord(text: string): number | null {
  if (!/^\d+(?:[.,]\d)?$/.test(text.trim())) return null;
  const raw = Math.round(Number(text.trim().replace(",", ".")) * 10);
  return Number.isInteger(raw) && raw >= 1 && raw <= 9999 ? raw : null;
}
