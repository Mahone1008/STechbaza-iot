import { isUuid } from "@/lib/api/inventory";
import type { SessionScope } from "@/lib/api";

type InventoryTarget = Readonly<{ organizationId?: string; siteId?: string; deviceId?: string; directory?: boolean; invalid?: boolean }>;
type SavedContext = Readonly<{ organizationId: string; siteId: string | null }>;
const PREFIX = "kerumo.context.v1:";
export function contextStorageKey(scope: SessionScope): string { return `${PREFIX}${scope.userId}:${scope.sessionId}`; }

export function inventoryTarget(pathname: string): InventoryTarget {
  if (pathname === "/organizations") return { directory: true };
  const members = /^\/organizations\/([^/]+)\/members$/u.exec(pathname);
  if (members) return members[1] && isUuid(members[1]) ? { organizationId: members[1] } : { invalid: true };
  const notification = /^\/organizations\/([^/]+)\/notifications(?:\/([^/]+))?$/u.exec(pathname);
  if (notification) return notification[1] && isUuid(notification[1]) && (!notification[2] || isUuid(notification[2])) ? { organizationId: notification[1] } : { invalid: true };
  if (pathname.startsWith("/notifications/")) return { invalid: true };
  const organization = /^\/organizations\/([^/]+)\/sites(?:\/([^/]+)\/devices)?$/u.exec(pathname);
  if (organization) {
    const [, organizationId, siteId] = organization;
    return organizationId && isUuid(organizationId) && (!siteId || isUuid(siteId)) ? { organizationId, ...(siteId ? { siteId } : {}) } : { invalid: true };
  }
  const device = /^\/devices\/([^/]+)$/u.exec(pathname);
  if (device) return device[1] && isUuid(device[1]) ? { deviceId: device[1] } : { invalid: true };
  const alarm = /^\/alarms\/devices\/([^/]+)(?:\/([^/]+))?$/u.exec(pathname);
  if (alarm) return alarm[1] && isUuid(alarm[1]) && (!alarm[2] || isUuid(alarm[2])) ? { deviceId: alarm[1] } : { invalid: true };
  if (pathname.startsWith("/alarms/")) return { invalid: true };
  return pathname.startsWith("/organizations/") ? { invalid: true } : {};
}

export function readSavedContext(scope: SessionScope): SavedContext | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(contextStorageKey(scope)) ?? "null");
    if (!raw || typeof raw !== "object" || !("organizationId" in raw) || !("siteId" in raw)) return null;
    if (typeof raw.organizationId !== "string" || !isUuid(raw.organizationId)) return null;
    if (raw.siteId !== null && (typeof raw.siteId !== "string" || !isUuid(raw.siteId))) return null;
    return { organizationId: raw.organizationId, siteId: raw.siteId };
  } catch { return null; }
}

export function saveContext(scope: SessionScope, value: SavedContext): void {
  try { sessionStorage.setItem(contextStorageKey(scope), JSON.stringify(value)); } catch { /* Заборона storage не блокує роботу. */ }
}
export function forgetContext(scope?: SessionScope): void {
  try {
    const root = scope ? contextStorageKey(scope) : null;
    // Разом із контекстом очищаємо вкладені UI preferences цієї сесії.
    Object.keys(sessionStorage).filter((key) => root ? key === root || key.startsWith(`${root}:`) : key.startsWith(PREFIX)).forEach((key) => sessionStorage.removeItem(key));
  } catch { /* Storage може бути недоступним. */ }
}
