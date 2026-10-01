import { invalidResponse, isRecord, requiredDateTime, requiredString } from "./access";
import type { components } from "./schema";

export type ControllerDiagnostics = components["schemas"]["ControllerDiagnostics"];
type StopDiagnostics = components["schemas"]["StopDiagnostics"];
const path = "/api/v1/devices/overview";

export const stopReasonLabels: Record<StopDiagnostics["reason"], string> = {
  command: "Команда STOP", local_disarm: "Локальний DISARM", bench_timer: "Завершився стендовий таймер",
  network_lost: "Втрачено готовність мережевого каналу", vfd_link_lost: "Втрачено зв’язок із частотником",
  vfd_fault: "Помилка частотника", configuration_mismatch: "Налаштування не відповідають профілю",
  storage_failed: "Помилка збереження стану", physical_result_unconfirmed: "Результат керування не підтверджено",
  restart_recovery: "Відновлення після перезапуску з незавершеним керуванням",
};
export const resetReasonLabels: Record<ControllerDiagnostics["reset_reason"], string> = {
  unknown: "Причину не визначено", power_on: "Увімкнення живлення", external: "Зовнішній RESET",
  software: "Програмний перезапуск", panic: "Збій програми", interrupt_watchdog: "Watchdog переривань",
  task_watchdog: "Watchdog задачі", watchdog: "Watchdog", deep_sleep: "Вихід із глибокого сну",
  brownout: "Просідання живлення", sdio: "Скидання SDIO",
};
export const transportLabels: Record<ControllerDiagnostics["connection"]["transport"], string> = {
  wifi: "Wi-Fi", cellular: "Мобільна мережа", ethernet: "Ethernet", unknown: "Не визначено",
};

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse(path, "diagnostic object");
  return value;
}
function uptime(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidResponse(path, "diagnostic uptime");
  return value;
}
function knownKey<T extends string>(value: unknown, labels: Record<T, string>): T {
  if (typeof value !== "string" || !Object.hasOwn(labels, value)) invalidResponse(path, "diagnostic code");
  return value as T;
}

export function parseDiagnostics(raw: unknown): ControllerDiagnostics | null {
  if (raw === null || raw === undefined) return null; // сумісність із попереднім API/firmware
  const data = record(raw);
  if (data.version !== 1) invalidResponse(path, "diagnostic version");
  const firmware = requiredString(data, "firmware_version", path);
  if (!/^[0-9A-Za-z.+_-]{1,32}$/.test(firmware)) invalidResponse(path, "firmware version");
  const uptimeMs = uptime(data.uptime_ms);
  const connection = record(data.connection);
  const transport = knownKey(connection.transport, transportLabels);
  let signal: ControllerDiagnostics["connection"]["signal"] = null;
  if (connection.signal !== null && connection.signal !== undefined) {
    const value = record(connection.signal);
    if ((value.metric !== "rssi" && value.metric !== "rsrp") || typeof value.dbm !== "number" || !Number.isSafeInteger(value.dbm)
      || value.dbm < -160 || value.dbm > 0 || !["wifi", "cellular"].includes(transport)
      || (transport === "wifi" && (value.metric !== "rssi" || value.dbm < -127))) invalidResponse(path, "radio signal");
    signal = { metric: value.metric, dbm: value.dbm };
  }
  let lastStop: StopDiagnostics | null = null;
  if (data.last_stop !== null && data.last_stop !== undefined) {
    const stop = record(data.last_stop);
    if (typeof stop.confirmed !== "boolean") invalidResponse(path, "stop confirmation");
    const stoppedAt = uptime(stop.uptime_ms);
    if (stoppedAt > uptimeMs) invalidResponse(path, "stop after sample");
    lastStop = {
      reason: knownKey(stop.reason, stopReasonLabels), uptime_ms: stoppedAt, confirmed: stop.confirmed,
      requested_at: stop.requested_at === null || stop.requested_at === undefined ? null : requiredDateTime(stop, "requested_at", path),
    };
  }
  return { version: 1, firmware_version: firmware, uptime_ms: uptimeMs, reset_reason: knownKey(data.reset_reason, resetReasonLabels), connection: { transport, signal }, last_stop: lastStop };
}

export function uptimeText(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  return `${days ? `${days} д ` : ""}${Math.floor(seconds / 3600) % 24} год ${Math.floor(seconds / 60) % 60} хв ${seconds % 60} с`;
}
