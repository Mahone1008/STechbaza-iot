"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuthSession } from "@/features/auth-session";
import { forgetContext, inventoryTarget, readSavedContext, saveContext } from "@/features/inventory-context";
import {
  apiErrorDisplayMessage, apiQueryKeys, clearAllSessionCaches, clearSessionCache, isApiError,
  parseCurrentUserResponse, parseOrganizationAccessResponse, parseOrganizationListResponse,
  type CurrentUserResponse, type OrganizationAccessResponse, type OrganizationResponse,
  type PermissionCode, type SessionScope,
} from "@/lib/api";
import { parseOrganization } from "@/lib/api/access";
import { matchingId, parseDevice, parsePage, parseSite, type Device, type Site } from "@/lib/api/inventory";

type IdentitySnapshot = Readonly<{ profile: CurrentUserResponse; scope: SessionScope }>;
export type DirectoryAccessSnapshot = IdentitySnapshot & Readonly<{ status: "directory" }>;
export type ReadyAccessSnapshot = IdentitySnapshot & Readonly<{
  status: "ready";
  activeOrganization: OrganizationResponse;
  activeSite: Site | null;
  activeDevice: Device | null;
  access: OrganizationAccessResponse;
}>;
export type AccessSnapshot =
  | Readonly<{ status: "idle" | "resolving" }>
  | DirectoryAccessSnapshot
  | ReadyAccessSnapshot
  | Readonly<{ status: "no-access"; profile: CurrentUserResponse | null; message: string; reason: "empty" | "denied" }>
  | Readonly<{ status: "unavailable"; message: string }>;

type AccessContextValue = Readonly<{
  snapshot: AccessSnapshot;
  retryAccess: () => void;
  hasPermission: (permission: PermissionCode) => boolean;
}>;
const AccessContext = createContext<AccessContextValue | null>(null);
class NoAccess extends Error {
  constructor(message: string, readonly reason: "empty" | "denied" = "denied") { super(message); }
}

export function AccessContextProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { session, authorizedRequest, clearSession } = useAuthSession();
  const [resolved, setResolved] = useState<{ pathname: string; snapshot: AccessSnapshot }>({ pathname: "", snapshot: { status: "idle" } });
  const [retryVersion, setRetryVersion] = useState(0);
  const activeScopeRef = useRef<SessionScope | null>(null);
  const runRef = useRef(0);
  const authenticatedEmail = session.status === "authenticated" ? session.email : null;

  useEffect(() => {
    const run = ++runRef.current;
    const controller = new AbortController();
    const current = () => run === runRef.current && !controller.signal.aborted;
    const publish = (snapshot: AccessSnapshot) => { if (current()) setResolved({ pathname, snapshot }); };
    const previousScope = activeScopeRef.current;
    activeScopeRef.current = null;
    // Старі tenant queries скасовуються й видаляються також при зміні маршруту.
    const cleared = previousScope ? clearSessionCache(queryClient, previousScope) : clearAllSessionCaches(queryClient);
    // На публічній сторінці не запускаємо запит, який скасує перехід після login.
    if (session.status !== "authenticated" || ["/login", "/register", "/invite", "/"].includes(pathname)) {
      if (session.status === "anonymous") forgetContext();
      queueMicrotask(() => publish({ status: "idle" }));
      return () => controller.abort();
    }
    queueMicrotask(() => publish({ status: "resolving" }));
    void (async () => {
      let phase: "profile" | "context" = "profile";
      let profile: CurrentUserResponse | null = null;
      let scope: SessionScope | undefined;
      const get = (path: string, query?: { limit: number; offset: number }) => authorizedRequest<unknown>({ path, ...(query ? { query } : {}), signal: controller.signal });
      try {
        await cleared;
        controller.signal.throwIfAborted();
        profile = parseCurrentUserResponse(await get("/api/v1/auth/me"));
        if (current() && process.env.NEXT_PUBLIC_PORTAL_MODE === "staff") {
          document.documentElement.dataset.theme = profile.platform_role === "superadmin" ? "admin" : "service";
        }
        if (!current()) return;
        if (!profile.is_active) { clearSession("revoked"); return; }
        scope = { userId: profile.id, sessionId: profile.auth_session_id };
        activeScopeRef.current = scope;
        phase = "context";
        const target = inventoryTarget(pathname);
        if (target.invalid) throw new NoAccess("Некоректне посилання на організацію, об’єкт або пристрій.");
        if (target.directory) {
          queryClient.setQueryData(apiQueryKeys.currentUser(scope), profile);
          publish({ status: "directory", profile, scope });
          return;
        }
        const saved = readSavedContext(scope);
        let organizationId = target.organizationId;
        let activeDevice: Device | null = null;
        let activeSite: Site | null = null;
        if (target.deviceId) {
          activeDevice = parseDevice(await get(`/api/v1/devices/${target.deviceId}`), undefined, target.deviceId);
          activeSite = parseSite(await get(`/api/v1/sites/${activeDevice.site_id}`), undefined, activeDevice.site_id);
          organizationId = activeSite.organization_id;
        }
        organizationId ??= saved?.organizationId;
        let activeOrganization: OrganizationResponse;
        if (organizationId) {
          activeOrganization = parseOrganization(await get(`/api/v1/organizations/${organizationId}`), "/api/v1/organizations");
          matchingId(activeOrganization.id, organizationId, "/api/v1/organizations");
        } else {
          // Перший вибір — лише з обмеженої сторінки. Повний каталог доступний окремо.
          const organizations = parseOrganizationListResponse(await get("/api/v1/organizations", { limit: 100, offset: 0 }));
          const selected = organizations.find((organization) => organization.is_active && (
            profile!.platform_role === "superadmin" || profile!.memberships.some((membership) => membership.organization_id === organization.id)
          ));
          if (!selected) throw new NoAccess("Для цього користувача немає активної доступної організації на початковій сторінці. Перевірте каталог організацій.", organizations.length === 0 ? "empty" : "denied");
          activeOrganization = selected;
          organizationId = selected.id;
        }
        if (!activeOrganization.is_active) throw new NoAccess("Організація неактивна. Оберіть іншу організацію.");
        const access = parseOrganizationAccessResponse(await get(`/api/v1/organizations/${organizationId}/access`), organizationId);
        const siteDirectory = pathname === "/devices" || pathname === "/alarms";
        const siteId = target.siteId ?? (!target.organizationId && !target.deviceId && siteDirectory ? saved?.siteId : null);
        if (siteId) activeSite = parseSite(await get(`/api/v1/sites/${siteId}`), organizationId, siteId);
        if (!activeSite && siteDirectory && access.permissions.includes("site.read")) {
          const sites = parsePage(await get(`/api/v1/organizations/${organizationId}/sites`, { limit: 1, offset: 0 }), (item) => parseSite(item, organizationId), 1);
          activeSite = sites[0] ?? null;
        }
        if (activeSite) matchingId(activeSite.organization_id, organizationId, "/api/v1/sites");
        if (!current()) return;
        queryClient.setQueryData(apiQueryKeys.currentUser(scope), profile);
        queryClient.setQueryData(apiQueryKeys.organizationAccess(scope, organizationId), access);
        // Зберігаємо тільки підтверджений явний вибір; жодних токенів чи назв.
        if (target.organizationId || target.deviceId) saveContext(scope, { organizationId, siteId: activeSite?.id ?? null });
        publish({ status: "ready", profile, scope, activeOrganization, activeSite, activeDevice, access });
      } catch (error) {
        if (!current() || (isApiError(error) && error.kind === "aborted")) return;
        if (phase === "profile" && isApiError(error) && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          clearSession(error.kind === "forbidden" ? "revoked" : "expired");
          return;
        }
        if (error instanceof NoAccess || (phase === "context" && isApiError(error) && (error.kind === "forbidden" || error.kind === "not-found"))) {
          if (scope) forgetContext(scope);
          publish({ status: "no-access", profile, reason: error instanceof NoAccess ? error.reason : "denied", message: error instanceof NoAccess ? error.message : "Організація або обладнання більше недоступні. Оберіть іншу організацію або зверніться до її адміністратора." });
          return;
        }
        publish({ status: "unavailable", message: apiErrorDisplayMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [authenticatedEmail, authorizedRequest, clearSession, pathname, queryClient, retryVersion, session.status]);

  // Не показуємо попередній tenant навіть на один render до виконання effect.
  const snapshot = useMemo<AccessSnapshot>(() => resolved.pathname === pathname ? resolved.snapshot : { status: "resolving" }, [resolved, pathname]);
  const retryAccess = useCallback(() => setRetryVersion((value) => value + 1), []);
  const hasPermission = useCallback((permission: PermissionCode) => snapshot.status === "ready" && (snapshot.access.permissions as readonly string[]).includes(permission), [snapshot]);
  const value = useMemo(() => ({ snapshot, retryAccess, hasPermission }), [snapshot, retryAccess, hasPermission]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}
export function useAccessContext(): AccessContextValue {
  const context = useContext(AccessContext);
  if (!context) throw new Error("useAccessContext must be used inside AccessContextProvider.");
  return context;
}
