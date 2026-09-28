import { invalidResponse, isRecord, requiredDateTime } from "./access";
import type { Channel, Overview } from "./overview";
import type { components } from "./schema";
export type Series = components["schemas"]["TelemetrySeriesRead"];
export type Bucket = Series["buckets"][number];
export type SeriesWindow = Readonly<{ start: string; end: string; bucket_seconds: number }>;
export const periods = [{ seconds: 3600, label: "1 година", bucket: 60 }, { seconds: 21600, label: "6 годин", bucket: 300 }, { seconds: 86400, label: "24 години", bucket: 900 }, { seconds: 604800, label: "7 днів", bucket: 3600 }] as const;
export function seriesChannels(overview: Overview): Channel[] {
  return overview.modules.filter((module) => module.supported).flatMap((module) => module.channels).filter((channel) => channel.supports_series && channel.source === "values" && channel.data_type === "number" && channel.unit !== null);
}
export function seriesWindow(seconds: number, bucket: number, now = Date.now()): SeriesWindow {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800 || !Number.isInteger(bucket) || bucket < 1 || bucket > 86400 || Math.ceil(seconds / bucket) > 1000 || !Number.isFinite(now)) throw new Error("Invalid history window");
  const end = Math.floor(now / 1000) * 1000;
  return { start: new Date(end - seconds * 1000).toISOString(), end: new Date(end).toISOString(), bucket_seconds: bucket };
}
const path = "/api/v1/devices/telemetry/series";
function object(raw: unknown) { if (!isRecord(raw)) invalidResponse(path, "object"); return raw; }
function count(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidResponse(path, key);
  return value;
}
function aggregate(raw: Record<string, unknown>, key: string): number | null {
  const value = raw[key];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) invalidResponse(path, key);
  return value;
}
export function parseSeries(raw: unknown, deviceId: string, channel: Channel, expected: SeriesWindow): Series {
  const data = object(raw);
  if (data.device_id !== deviceId || data.metric !== channel.key || data.unit !== channel.unit || data.time_basis !== "server_received_at" || data.bucket_seconds !== expected.bucket_seconds) invalidResponse(path, "series identity/unit/bucket");
  const start = requiredDateTime(data, "start", path), end = requiredDateTime(data, "end", path);
  if (Date.parse(start) !== Date.parse(expected.start) || Date.parse(end) !== Date.parse(expected.end)) invalidResponse(path, "requested time window");
  const messageCount = count(data, "message_count"), sampleCount = count(data, "sample_count"), maxMessages = count(data, "max_messages");
  if (maxMessages < 1 || maxMessages > 100000 || messageCount > maxMessages) invalidResponse(path, "message budget");
  const length = Math.ceil((Date.parse(end) - Date.parse(start)) / (expected.bucket_seconds * 1000));
  if (length < 1 || length > 1000 || !Array.isArray(data.buckets) || data.buckets.length !== length) invalidResponse(path, "complete bounded buckets");
  let totalSamples = 0, totalMessages = 0;
  const buckets = data.buckets.map((rawBucket, index): Bucket => {
    const b = object(rawBucket);
    const from = requiredDateTime(b, "start", path), to = requiredDateTime(b, "end", path);
    const expectedStart = Date.parse(start) + index * expected.bucket_seconds * 1000;
    if (Date.parse(from) !== expectedStart || Date.parse(to) !== Math.min(Date.parse(end), expectedStart + expected.bucket_seconds * 1000)) invalidResponse(path, "contiguous bucket bounds");
    const samples = count(b, "sample_count"), missing = count(b, "missing_count"), invalid = count(b, "invalid_count");
    const minimum = aggregate(b, "minimum"), maximum = aggregate(b, "maximum"), average = aggregate(b, "average");
    const status: Bucket["status"] = samples ? missing || invalid ? "partial" : "ok" : invalid ? "invalid" : missing ? "missing" : "empty";
    if (b.status !== status) invalidResponse(path, "coherent bucket status");
    if (samples ? minimum === null || maximum === null || average === null || minimum > average || average > maximum : minimum !== null || maximum !== null || average !== null) invalidResponse(path, "coherent aggregates");
    totalSamples += samples; totalMessages += samples + missing + invalid;
    return { start: from, end: to, status, sample_count: samples, missing_count: missing, invalid_count: invalid, minimum, maximum, average };
  });
  if (totalSamples !== sampleCount || totalMessages !== messageCount) invalidResponse(path, "complete counts");
  return { device_id: deviceId, metric: channel.key, unit: channel.unit!, start, end, bucket_seconds: expected.bucket_seconds, time_basis: "server_received_at", generated_at: requiredDateTime(data, "generated_at", path), message_count: messageCount, sample_count: sampleCount, max_messages: maxMessages, buckets };
}
export const bucketLabels: Record<Bucket["status"], string> = { ok: "Повні дані", partial: "Часткові дані", empty: "Немає повідомлень", missing: "Немає метрики", invalid: "Некоректні дані" };
