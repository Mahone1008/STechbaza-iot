import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import type { components } from "./schema";
import { parseProgramPlan, sameProgram, type ProgramPlan } from "./programs";
import { parseEquipmentTarget, sameEquipmentTarget } from "./equipment";
export type Command = components["schemas"]["DeviceCommandRead"];
export type CommandType = components["schemas"]["DeviceCommandCreate"]["command_type"];
export type CommandInput = components["schemas"]["DeviceCommandCreate"];
export type CommandCursor = Readonly<{ before_created_at: string; before_id: string }>;
const commandLabels: Record<CommandType, string> = { "vfd.start": "Запустити", "vfd.stop": "Зупинити", "vfd.frequency.set": "Задати частоту", "vfd.program.start": "Запустити за етапами", "vfd.schedule.start": "Запуск за розкладом" };
export const statusLabels: Record<string, string> = { queued: "У черзі", published: "Розпочато доставку", acknowledged: "Контролер підтвердив прийом", succeeded: "Контролер повідомив про виконання", failed: "Помилка виконання", cancelled: "Доставку скасовано", expired: "Строк доставки минув", result_unknown: "Результат невідомий" };
export function commandWorkMode(command: Pick<Command, "command_type" | "payload">): "timer" | "program" | "schedule" | null {
  if (command.command_type === "vfd.schedule.start") return "schedule";
  if (command.command_type !== "vfd.program.start") return null;
  const plan = parseProgramPlan(command.payload);
  return plan ? plan.steps.length === 1 ? "timer" : "program" : null;
}
export function commandLabel(type: string, payload?: unknown) {
  if (type === "vfd.program.start" && parseProgramPlan(payload)?.steps.length === 1) return "Запуск за таймером";
  return Object.hasOwn(commandLabels, type) ? commandLabels[type as CommandType] : type;
}
export function commandPending(command: Command) { return ["queued", "published", "acknowledged"].includes(command.status); }
export function validFrequency(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
export function makeCommandInput(type: CommandType, frequency: string, ttl: number, requestId: string, program?: ProgramPlan | null): CommandInput {
  if (!Number.isInteger(ttl) || ttl < 5 || ttl > 300) throw new Error("Час на прийняття команди має бути від 5 до 300 секунд.");
  if (type === "vfd.program.start") {
    const plan = parseProgramPlan(program);
    if (!plan) throw new Error("Перевірте частоти та тривалість етапів програми.");
    return { request_id: requestId, command_type: type, payload: { version: plan.version, steps: plan.steps }, ttl_seconds: ttl };
  }
  const value = validFrequency(frequency);
  if (type === "vfd.frequency.set" && value === null) throw new Error("Вкажіть частоту від 0 до 100 Гц.");
  return { request_id: requestId, command_type: type, payload: type === "vfd.frequency.set" ? { frequency_hz: value! } : {}, ttl_seconds: ttl };
}
const path = "/api/v1/commands";
// Preserve PostgreSQL microseconds: Date.parse alone collapses distinct cursor times.
function micros(value: string): number {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "";
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6));
}
function isBefore(command: Command, cursor: CommandCursor) {
  const time = micros(command.created_at), boundary = micros(cursor.before_created_at);
  return time < boundary || (time === boundary && command.id.toLowerCase() < cursor.before_id.toLowerCase());
}
export function commandCursor(command: Command): CommandCursor { return { before_created_at: command.created_at, before_id: command.id }; }
export function parseCommand(raw: unknown, deviceId: string, organizationId: string, expectedId?: string): Command {
  if (!isRecord(raw)) invalidResponse(path, "command object");
  for (const field of ["id", "request_id", "device_id"]) requiredUuid(raw, field, path);
  if (raw.device_id !== deviceId || (expectedId && raw.id !== expectedId)) invalidResponse(path, "command scope");
  for (const field of ["actor_user_id", "actor_auth_session_id", "actor_organization_id"]) if (raw[field] !== null) requiredUuid(raw, field, path);
  if (raw.actor_organization_id !== null && raw.actor_organization_id !== organizationId) invalidResponse(path, "actor organization");
  for (const field of ["actor_platform_role", "actor_organization_role", "actor_email", "actor_display_name", "last_publish_error", "error_code", "error_message"]) {
    if (raw[field] !== null && typeof raw[field] !== "string") invalidResponse(path, field);
  }
  if (raw.control_sequence !== undefined && raw.control_sequence !== null && (typeof raw.control_sequence !== "number" || !Number.isSafeInteger(raw.control_sequence) || raw.control_sequence < 1)) invalidResponse(path, "control sequence");
  if (raw.supersedes_request_id !== undefined && raw.supersedes_request_id !== null) requiredUuid(raw, "supersedes_request_id", path);
  parseEquipmentTarget(raw.equipment_target);
  requiredString(raw, "command_type", path);
  if (typeof raw.status !== "string" || !Object.hasOwn(statusLabels, raw.status)) invalidResponse(path, "command status");
  if (!isRecord(raw.payload) || !isRecord(raw.result)) invalidResponse(path, "command payload/result");
  for (const field of ["created_at", "updated_at", "expires_at"]) requiredDateTime(raw, field, path);
  for (const field of ["published_at", "last_publish_attempt_at", "acknowledged_at", "result_deadline_at", "result_timed_out_at", "completed_at"]) if (raw[field] !== null) requiredDateTime(raw, field, path);
  if (typeof raw.ttl_seconds !== "number" || !Number.isInteger(raw.ttl_seconds) || raw.ttl_seconds < 5 || raw.ttl_seconds > 300 || typeof raw.publish_attempts !== "number" || !Number.isSafeInteger(raw.publish_attempts) || raw.publish_attempts < 0) invalidResponse(path, "command counters");
  return raw as Command;
}
export function parseCommandReceipt(raw: unknown, deviceId: string, organizationId: string, userId: string, input: CommandInput): Command {
  const command = parseCommand(raw, deviceId, organizationId);
  if (!sameEquipmentTarget(command.equipment_target, input.equipment_target)) invalidResponse(path, "matching equipment target");
  if (command.request_id !== input.request_id || command.command_type !== input.command_type || command.ttl_seconds !== input.ttl_seconds || (command.supersedes_request_id ?? null) !== (input.supersedes_request_id ?? null) || command.actor_user_id !== userId || command.actor_organization_id !== organizationId || (input.command_type === "vfd.program.start" ? !sameProgram(command.payload, input.payload) : Object.keys(command.payload).length !== Object.keys(input.payload ?? {}).length || Object.entries(input.payload ?? {}).some(([key, value]) => command.payload[key] !== value))) invalidResponse(path, "matching command receipt");
  return command;
}
export function parseCommandPage(raw: unknown, deviceId: string, organizationId: string, cursor: CommandCursor | null): Command[] {
  if (!Array.isArray(raw) || raw.length > 21) invalidResponse(path, "bounded command page");
  const commands = raw.map((row) => parseCommand(row, deviceId, organizationId));
  if (new Set(commands.map((row) => row.id)).size !== commands.length) invalidResponse(path, "unique commands");
  commands.forEach((row, index) => { const boundary = index ? commandCursor(commands[index - 1]!) : cursor; if (boundary && !isBefore(row, boundary)) invalidResponse(path, "ordered cursor page"); });
  return commands;
}
