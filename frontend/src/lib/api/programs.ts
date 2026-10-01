import { invalidResponse, isRecord, requiredUuid } from "./access";
import type { components } from "./schema";

export type ProgramStep = Readonly<{ frequency_hz: number; duration_seconds: number }>;
export type ProgramPlan = Readonly<{ version: 1; steps: ProgramStep[] }>;
export type ProgramProgress = components["schemas"]["ProgramProgress"];
export const MAX_PROGRAM_STEPS = 8;
export const MAX_PROGRAM_SECONDS = 86400;
export const programStateLabels: Record<ProgramProgress["state"], string> = {
  idle: "Готовий до програми", setting: "Встановлення частоти", starting: "Очікування робочої частоти",
  holding: "Виконується", stopping: "Очікування підтвердження зупинки", completed: "Програму завершено",
  interrupted: "Програму перервано", failed: "Помилка програми",
};
export function programActive(progress: ProgramProgress | null | undefined) {
  return !!progress && ["setting", "starting", "holding", "stopping"].includes(progress.state);
}
export function durationText(seconds: number) {
  const parts = [Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)} год` : "", Math.floor(seconds % 3600 / 60) ? `${Math.floor(seconds % 3600 / 60)} хв` : "", seconds % 60 ? `${seconds % 60} с` : ""];
  return parts.filter(Boolean).join(" ") || "0 с";
}
export function parseProgramPlan(raw: unknown): ProgramPlan | null {
  if (!isRecord(raw) || raw.version !== 1 || Object.keys(raw).length !== 2 || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_PROGRAM_STEPS) return null;
  const steps: ProgramStep[] = [];
  for (const step of raw.steps) {
    if (!isRecord(step) || Object.keys(step).length !== 2 || typeof step.frequency_hz !== "number" || !Number.isFinite(step.frequency_hz)
      || step.frequency_hz <= 0 || step.frequency_hz > 100 || Math.abs(step.frequency_hz * 100 - Math.round(step.frequency_hz * 100)) > 0.000001
      || typeof step.duration_seconds !== "number" || !Number.isInteger(step.duration_seconds) || step.duration_seconds < 10 || step.duration_seconds > MAX_PROGRAM_SECONDS) return null;
    steps.push({ frequency_hz: step.frequency_hz, duration_seconds: step.duration_seconds });
  }
  return steps.reduce((sum, step) => sum + step.duration_seconds, 0) <= MAX_PROGRAM_SECONDS ? { version: 1, steps } : null;
}
export function sameProgram(a: unknown, b: unknown) {
  const left = parseProgramPlan(a), right = parseProgramPlan(b);
  return !!left && !!right && left.steps.length === right.steps.length && left.steps.every((step, index) => step.frequency_hz === right.steps[index]!.frequency_hz && step.duration_seconds === right.steps[index]!.duration_seconds);
}
export function programWithinLimits(plan: ProgramPlan, limits: { min_hz: number; max_hz: number } | null) {
  return !!limits && plan.steps.every((step) => step.frequency_hz >= limits.min_hz && step.frequency_hz <= limits.max_hz);
}
export function parseProgramProgress(raw: unknown): ProgramProgress | null {
  if (raw === null || raw === undefined) return null;
  const path = "/api/v1/devices/overview";
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.ready !== "boolean" || typeof raw.state !== "string" || !Object.hasOwn(programStateLabels, raw.state)) invalidResponse(path, "program progress");
  for (const key of ["step_index", "step_count"]) if (typeof raw[key] !== "number" || !Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > MAX_PROGRAM_STEPS) invalidResponse(path, "program step");
  if ((raw.step_index as number) > (raw.step_count as number)) invalidResponse(path, "program step order");
  if (raw.command_id !== null) requiredUuid(raw, "command_id", path);
  if (raw.target_frequency_hz !== null && (typeof raw.target_frequency_hz !== "number" || !Number.isFinite(raw.target_frequency_hz) || raw.target_frequency_hz < 0 || raw.target_frequency_hz > 100)) invalidResponse(path, "program frequency");
  if (raw.remaining_seconds !== null && (typeof raw.remaining_seconds !== "number" || !Number.isInteger(raw.remaining_seconds) || raw.remaining_seconds < 0 || raw.remaining_seconds > MAX_PROGRAM_SECONDS)) invalidResponse(path, "program remaining time");
  if (raw.reason !== null && (typeof raw.reason !== "string" || raw.reason.length > 96)) invalidResponse(path, "program reason");
  if (raw.state === "idle" ? (raw.command_id !== null || raw.step_index !== 0 || raw.step_count !== 0 || raw.target_frequency_hz !== null || raw.remaining_seconds !== null || raw.reason !== null) : (raw.command_id === null || raw.step_count === 0)) invalidResponse(path, "program identity");
  if (["setting", "starting", "holding"].includes(raw.state) && (raw.step_index === 0 || raw.target_frequency_hz === null)) invalidResponse(path, "program active target");
  if (raw.state === "holding" && raw.remaining_seconds === null) invalidResponse(path, "program hold time");
  return raw as ProgramProgress;
}
