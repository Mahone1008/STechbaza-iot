import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import type { paths } from "./schema";

export type Site = paths["/api/v1/sites/{site_id}"]["get"]["responses"][200]["content"]["application/json"];
export type Device = paths["/api/v1/devices/{device_id}"]["get"]["responses"][200]["content"]["application/json"];
export type Availability = paths["/api/v1/devices/{device_id}/availability"]["get"]["responses"][200]["content"]["application/json"];
export const PAGE_SIZE = 20;
export const PRESENCE_CONCURRENCY = 4;
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

export function matchingId(actual: string, expected: string, path: string): void {
  if (actual !== expected) invalidResponse(path, "matching id / parent id");
}

export function parseSite(value: unknown, organizationId?: string, siteId?: string): Site {
  const path = "/api/v1/sites";
  if (!isRecord(value)) invalidResponse(path, "SiteRead");
  const site: Site = {
    id: requiredUuid(value, "id", path),
    organization_id: requiredUuid(value, "organization_id", path),
    name: requiredString(value, "name", path),
    code: requiredString(value, "code", path),
    timezone: requiredString(value, "timezone", path),
    created_at: requiredDateTime(value, "created_at", path),
    updated_at: requiredDateTime(value, "updated_at", path),
  };
  if (organizationId) matchingId(site.organization_id, organizationId, path);
  if (siteId) matchingId(site.id, siteId, path);
  return site;
}

function nullableDate(record: Record<string, unknown>, key: string, path: string) {
  return record[key] === null ? null : requiredDateTime(record, key, path);
}

export function parseDevice(value: unknown, siteId?: string, deviceId?: string): Device {
  const path = "/api/v1/devices";
  if (!isRecord(value)) invalidResponse(path, "DeviceRead");
  const device: Device = {
    id: requiredUuid(value, "id", path),
    site_id: requiredUuid(value, "site_id", path),
    name: requiredString(value, "name", path),
    uid: requiredString(value, "uid", path),
    device_type: requiredString(value, "device_type", path),
    lifecycle_status: requiredString(value, "lifecycle_status", path),
    last_seen_at: nullableDate(value, "last_seen_at", path),
    created_at: requiredDateTime(value, "created_at", path),
    updated_at: requiredDateTime(value, "updated_at", path),
  };
  if (siteId) matchingId(device.site_id, siteId, path);
  if (deviceId) matchingId(device.id, deviceId, path);
  return device;
}

export function parsePage<T extends { id: string }>(value: unknown, parse: (item: unknown) => T, limit = PAGE_SIZE + 1): T[] {
  if (!Array.isArray(value) || value.length > limit) invalidResponse("/api/v1", "bounded page");
  const items = value.map(parse);
  if (new Set(items.map((item) => item.id)).size !== items.length) invalidResponse("/api/v1", "unique ids");
  return items;
}

export function parseAvailability(value: unknown, device: Pick<Device, "id" | "uid">): Availability {
  const path = `/api/v1/devices/${device.id}/availability`;
  if (!isRecord(value) || typeof value.online !== "boolean") invalidResponse(path, "DeviceAvailabilityRead");
  const deviceId = requiredUuid(value, "device_id", path);
  matchingId(deviceId, device.id, path);
  const uid = requiredString(value, "uid", path);
  matchingId(uid, device.uid, path);
  const timeout = value.timeout_seconds;
  const elapsed = value.seconds_since_seen;
  if (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout <= 0) invalidResponse(path, "timeout_seconds");
  if (elapsed !== null && (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0)) invalidResponse(path, "seconds_since_seen");
  const lastSeen = nullableDate(value, "last_seen_at", path);
  if (lastSeen === null && value.online) invalidResponse(path, "online requires last_seen_at");
  return { device_id: deviceId, uid, online: value.online, last_seen_at: lastSeen, timeout_seconds: timeout, seconds_since_seen: elapsed };
}

// Черга не починає нові запити після abort; порядок результатів відповідає рядкам.
export async function mapBounded<T, R>(items: readonly T[], concurrency: number, signal: AbortSignal, task: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid concurrency");
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }));
  signal.throwIfAborted();
  return results;
}

export function formatSeen(value: string | null, timezone = "UTC"): string {
  if (value === null) return "Ще не було зв’язку";
  try {
    return new Intl.DateTimeFormat("uk-UA", { timeZone: timezone, dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  } catch {
    return `${new Date(value).toISOString()} (UTC)`;
  }
}
