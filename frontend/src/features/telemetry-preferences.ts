import { contextStorageKey } from "@/features/inventory-context";
import type { SessionScope } from "@/lib/api";
import { isRecord } from "@/lib/api/access";
import type { Channel } from "@/lib/api/overview";
import { historyBuckets, periods } from "@/lib/api/telemetry-series";

export type HistorySelection = Readonly<{ metric: string; seconds: number; bucket: number }>;

export function historyPreferencesKey(scope: SessionScope, organizationId: string, deviceId: string): string {
  return `${contextStorageKey(scope)}:history:${organizationId}:${deviceId}`;
}

// Browser storage — недовірене джерело. Канали вже обмежені enabled modules.
export function normalizeHistorySelection(raw: unknown, channels: readonly Channel[]): HistorySelection {
  const data = isRecord(raw) ? raw : {};
  const period = periods.find((item) => item.seconds === data.seconds) ?? periods[0];
  const bucket = historyBuckets.find((value) => value === data.bucket && Math.ceil(period.seconds / value) <= 1000) ?? period.bucket;
  return { metric: channels.find((channel) => channel.key === data.metric)?.key ?? channels[0]?.key ?? "", seconds: period.seconds, bucket };
}

export function readHistorySelection(key: string, channels: readonly Channel[]): HistorySelection {
  try { return normalizeHistorySelection(JSON.parse(sessionStorage.getItem(key) ?? "null"), channels); }
  catch { return normalizeHistorySelection(null, channels); }
}

export function saveHistorySelection(key: string, value: HistorySelection): void {
  try { sessionStorage.setItem(key, JSON.stringify({ metric: value.metric, seconds: value.seconds, bucket: value.bucket })); }
  catch { /* Заборона/quota storage не блокує графік; вибір залишається у React state. */ }
}
