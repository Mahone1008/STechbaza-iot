import type { Series, SeriesWindow } from "../../src/lib/api/telemetry-series";
import { overviewDevice } from "./overview";
export function seriesFixture(window: SeriesWindow, metric = "pressure.bar", deviceId = overviewDevice.id, populated = false): Series {
  const size = Math.ceil((Date.parse(window.end) - Date.parse(window.start)) / (window.bucket_seconds * 1000));
  const buckets = Array.from({ length: size }, (_, i): Series["buckets"][number] => {
    const start = Date.parse(window.start) + i * window.bucket_seconds * 1000;
    const valid = populated && (i === 0 || i === 2);
    return { start: new Date(start).toISOString(), end: new Date(Math.min(Date.parse(window.end), start + window.bucket_seconds * 1000)).toISOString(), status: valid ? i === 2 ? "partial" : "ok" : "empty", sample_count: valid ? 1 : 0, missing_count: populated && i === 2 ? 1 : 0, invalid_count: 0, minimum: valid ? i : null, maximum: valid ? i : null, average: valid ? i : null };
  });
  return { ...window, device_id: deviceId, metric, unit: metric === "water_level.percent" ? "%" : "bar", time_basis: "server_received_at", generated_at: window.end, max_messages: 100000, message_count: buckets.reduce((n, b) => n + b.sample_count + b.missing_count, 0), sample_count: buckets.reduce((n, b) => n + b.sample_count, 0), buckets };
}
