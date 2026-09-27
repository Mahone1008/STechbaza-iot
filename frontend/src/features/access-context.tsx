"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuthSession } from "@/features/auth-session";
import {
  apiErrorDisplayMessage,
  apiQueryKeys,
  clearAllSessionCaches,
  clearSessionCache,
  isApiError,
  parseCurrentUserResponse,
  parseOrganizationAccessResponse,
  parseOrganizationListResponse,
  type CurrentUserResponse,
  type OrganizationAccessResponse,
  type OrganizationListResponse,
  type OrganizationResponse,
  type PermissionCode,
  type SessionScope,
} from "@/lib/api";

export type ReadyAccessSnapshot = Readonly<{
  status: "ready";
  profile: CurrentUserResponse;
  organizations: OrganizationListResponse;
  activeOrganization: OrganizationResponse;
  access: OrganizationAccessResponse;
  scope: SessionScope;
}>;

export type AccessSnapshot =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "resolving" }>
  | ReadyAccessSnapshot
  | Readonly<{ status: "no-access"; profile: CurrentUserResponse | null; message: string }>
  | Readonly<{ status: "unavailable"; message: string }>;

type AccessContextValue = Readonly<{
  snapshot: AccessSnapshot;
  retryAccess: () => void;
  hasPermission: (permission: PermissionCode) => boolean;
}>;

const AccessContext = createContext<AccessContextValue | null>(null);

function sameScope(left: SessionScope | null, right: SessionScope): boolean {
  return left?.userId === right.userId && left.sessionId === right.sessionId;
}

function selectOrganization(
  profile: CurrentUserResponse,
  organizations: OrganizationListResponse,
): OrganizationResponse | null {
  const activeOrganizations = organizations.filter((organization) => organization.is_active);
  const byId = new Map(activeOrganizations.map((organization) => [organization.id, organization]));

  for (const membership of profile.memberships) {
    const organization = byId.get(membership.organization_id);
    if (organization) return organization;
  }

  if (profile.platform_role === "superadmin") return activeOrganizations[0] ?? null;
  return null;
}

export function AccessContextProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const { session, authorizedRequest, clearSession } = useAuthSession();
  const [snapshot, setSnapshot] = useState<AccessSnapshot>({ status: "idle" });
  const [retryVersion, setRetryVersion] = useState(0);
  const activeScopeRef = useRef<SessionScope | null>(null);
  const runRef = useRef(0);

  const authenticatedEmail = session.status === "authenticated" ? session.email : null;

  useEffect(() => {
    const run = ++runRef.current;

    if (session.status !== "authenticated") {
      const previousScope = activeScopeRef.current;
      activeScopeRef.current = null;
      setSnapshot({ status: "idle" });
      if (previousScope) {
        void clearSessionCache(queryClient, previousScope);
      } else {
        void clearAllSessionCaches(queryClient);
      }
      return;
    }

    const controller = new AbortController();
    setSnapshot({ status: "resolving" });

    void (async () => {
      let phase: "profile" | "organizations" | "access" = "profile";
      let profile: CurrentUserResponse | null = null;

      try {
        const profilePayload = await authorizedRequest<unknown>({
          path: "/api/v1/auth/me",
          signal: controller.signal,
        });
        profile = parseCurrentUserResponse(profilePayload);
        if (!profile.is_active) {
          clearSession();
          return;
        }

        const scope: SessionScope = {
          userId: profile.id,
          sessionId: profile.auth_session_id,
        };
        const previousScope = activeScopeRef.current;
        if (previousScope && !sameScope(previousScope, scope)) {
          await clearSessionCache(queryClient, previousScope);
        }
        if (run !== runRef.current || controller.signal.aborted) return;

        activeScopeRef.current = scope;
        queryClient.setQueryData(apiQueryKeys.currentUser(scope), profile);

        phase = "organizations";
        const organizationsPayload = await authorizedRequest<unknown>({
          path: "/api/v1/organizations",
          query: { limit: 100, offset: 0 },
          signal: controller.signal,
        });
        const organizations = parseOrganizationListResponse(organizationsPayload);
        queryClient.setQueryData(apiQueryKeys.organizations(scope), organizations);

        const activeOrganization = selectOrganization(profile, organizations);
        if (!activeOrganization) {
          if (run === runRef.current && !controller.signal.aborted) {
            setSnapshot({
              status: "no-access",
              profile,
              message: "Для цього користувача немає активної доступної організації.",
            });
          }
          return;
        }

        phase = "access";
        const accessPayload = await authorizedRequest<unknown>({
          path: `/api/v1/organizations/${encodeURIComponent(activeOrganization.id)}/access`,
          signal: controller.signal,
        });
        const access = parseOrganizationAccessResponse(accessPayload, activeOrganization.id);
        queryClient.setQueryData(apiQueryKeys.organizationAccess(scope, activeOrganization.id), access);

        if (run !== runRef.current || controller.signal.aborted) return;
        setSnapshot({
          status: "ready",
          profile,
          organizations,
          activeOrganization,
          access,
          scope,
        });
      } catch (error) {
        if (run !== runRef.current || controller.signal.aborted) return;
        if (isApiError(error) && error.kind === "aborted") return;

        if (phase === "profile" && isApiError(error) && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          clearSession();
          return;
        }

        if (
          phase !== "profile"
          && isApiError(error)
          && (error.kind === "forbidden" || error.kind === "not-found")
        ) {
          setSnapshot({
            status: "no-access",
            profile,
            message: "Доступ до організації відкликано або вона більше недоступна.",
          });
          return;
        }

        setSnapshot({
          status: "unavailable",
          message: apiErrorDisplayMessage(error),
        });
      }
    })();

    return () => controller.abort();
  }, [authenticatedEmail, authorizedRequest, clearSession, queryClient, retryVersion, session.status]);

  const retryAccess = useCallback(() => setRetryVersion((value) => value + 1), []);
  const hasPermission = useCallback(
    (permission: PermissionCode) => snapshot.status === "ready"
      && (snapshot.access.permissions as readonly string[]).includes(permission),
    [snapshot],
  );

  const value = useMemo<AccessContextValue>(
    () => ({ snapshot, retryAccess, hasPermission }),
    [hasPermission, retryAccess, snapshot],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccessContext(): AccessContextValue {
  const context = useContext(AccessContext);
  if (!context) throw new Error("useAccessContext must be used inside AccessContextProvider.");
  return context;
}
