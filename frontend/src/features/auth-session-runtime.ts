import {
  ApiError,
  apiRequest,
  browserRefresh,
  isApiError,
  type ApiRequestOptions,
  type BrowserLoginRequest,
  type BrowserLoginResponse,
} from "@/lib/api";
import {
  createAuthTabId,
  isSnapshotUsable,
  withCrossTabAuthLock,
  type AuthSessionSnapshotMessage,
} from "./auth-coordination";

export const DOCUMENT_TAB_ID = createAuthTabId();
export const PEER_RESPONSE_WINDOW_MS = 350;
export const MIN_ACCESS_VALIDITY_MS = 30_000;
export const MIN_PEER_TOKEN_VALIDITY_MS = 5_000;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type AuthenticatedSession = Readonly<{
  status: "authenticated";
  email: string | null;
  accessExpiresAt: number;
  sessionExpiresAt: number;
  source: "login" | "refresh" | "peer";
  refreshState: "ready" | "degraded";
  refreshMessage: string | null;
}>;

export type AuthSessionSnapshot =
  | Readonly<{ status: "restoring"; startedAt: number }>
  | Readonly<{ status: "anonymous"; reason: "none" | "expired" | "revoked" | "logout" }>
  | AuthenticatedSession
  | Readonly<{ status: "unavailable"; message: string; retryAt: number | null }>
  | Readonly<{ status: "logging-out"; startedAt: number; email: string | null }>
  | Readonly<{
      status: "logout-failed";
      message: string;
      retryAt: number | null;
      email: string | null;
    }>;

export type AuthorizedApiRequestOptions = Omit<ApiRequestOptions, "accessToken"> &
  Readonly<{
    retryOnUnauthorized?: boolean;
  }>;

export type RefreshReason = "startup" | "timer" | "visibility" | "demand" | "unauthorized" | "retry";
export type SessionInvalidationReason = "expired" | "revoked";

export type AuthSessionContextValue = Readonly<{
  session: AuthSessionSnapshot;
  login: (payload: BrowserLoginRequest, signal?: AbortSignal) => Promise<BrowserLoginResponse>;
  logout: () => Promise<boolean>;
  cancelLogout: () => void;
  refreshSession: (reason?: RefreshReason) => Promise<boolean>;
  clearSession: (reason?: SessionInvalidationReason) => void;
  getAccessToken: (minimumValidityMs?: number) => Promise<string | null>;
  authorizedRequest: <T>(options: AuthorizedApiRequestOptions) => Promise<T>;
}>;

type RefreshOutcome =
  | Readonly<{ kind: "peer"; snapshot: AuthSessionSnapshotMessage }>
  | Readonly<{ kind: "api"; response: BrowserLoginResponse; issuedAt: number }>;

export type PeerSnapshotResolver = (snapshot: AuthSessionSnapshotMessage | null) => void;
export type LogoutFallback = Readonly<{ session: AuthenticatedSession; accessToken: string }>;

let sameDocumentRefreshPromise: Promise<RefreshOutcome> | null = null;

export function isNewUsablePeerSnapshot(
  snapshot: AuthSessionSnapshotMessage | null,
  baselineEventAt: number,
): snapshot is AuthSessionSnapshotMessage {
  return (
    snapshot !== null &&
    snapshot.issuedAt > baselineEventAt &&
    isSnapshotUsable(snapshot, Date.now(), MIN_PEER_TOKEN_VALIDITY_MS)
  );
}

export async function coordinatedBrowserRefresh(
  baselineEventAt: number,
  getLatestPeerSnapshot: () => AuthSessionSnapshotMessage | null,
  requestPeerSnapshot: () => Promise<AuthSessionSnapshotMessage | null>,
  commitApiRefresh: (response: BrowserLoginResponse, issuedAt: number) => void,
): Promise<RefreshOutcome> {
  if (sameDocumentRefreshPromise) return sameDocumentRefreshPromise;

  const promise = withCrossTabAuthLock(DOCUMENT_TAB_ID, async () => {
    const cachedPeer = getLatestPeerSnapshot();
    if (isNewUsablePeerSnapshot(cachedPeer, baselineEventAt)) {
      return { kind: "peer", snapshot: cachedPeer } as const;
    }

    const requestedPeer = await requestPeerSnapshot();
    if (isNewUsablePeerSnapshot(requestedPeer, baselineEventAt)) {
      return { kind: "peer", snapshot: requestedPeer } as const;
    }

    const response = await browserRefresh();
    const issuedAt = Date.now();
    commitApiRefresh(response, issuedAt);
    return { kind: "api", response, issuedAt } as const;
  }).finally(() => {
    sameDocumentRefreshPromise = null;
  });

  sameDocumentRefreshPromise = promise;
  return promise;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function sessionOrigin(session: AuthenticatedSession): "login" | "refresh" {
  return session.source === "login" ? "login" : "refresh";
}

function noAccessTokenError(path: string): ApiError {
  return new ApiError("Сесію не вдалося підтвердити.", {
    kind: "unauthorized",
    status: 401,
    method: "GET",
    url: path,
    retryAfterSeconds: null,
    requestId: null,
    details: null,
  });
}

function logoutCancelledRequestError(path: string, method: string): ApiError {
  return new ApiError("Запит скасовано під час завершення сесії.", {
    kind: "aborted",
    status: null,
    method,
    url: path,
    retryAfterSeconds: null,
    requestId: null,
    details: { reason: "logout" },
  });
}

function createLinkedRequestController(externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    controller,
    cleanup: () => externalSignal?.removeEventListener("abort", abortFromExternal),
  };
}

type RequestDependencies = {
  activeControllers: () => Set<AbortController>;
  logoutRequested: () => boolean;
  currentAccessToken: () => string | null;
  getAccessToken: () => Promise<string | null>;
  refreshSession: (reason: RefreshReason) => Promise<boolean>;
};

export async function authorizedApiRequest<T>(
  dependencies: RequestDependencies,
  options: AuthorizedApiRequestOptions,
): Promise<T> {
  const method = options.method ?? "GET";
  const linked = createLinkedRequestController(options.signal);
  dependencies.activeControllers().add(linked.controller);

  try {
    if (dependencies.logoutRequested()) throw logoutCancelledRequestError(options.path, method);
    const token = await dependencies.getAccessToken();
    if (linked.controller.signal.aborted || dependencies.logoutRequested()) {
      throw logoutCancelledRequestError(options.path, method);
    }
    if (!token) throw noAccessTokenError(options.path);

    const { retryOnUnauthorized, signal: _signal, ...requestOptions } = options;
    void _signal;

    try {
      return await apiRequest<T>({
        ...requestOptions,
        accessToken: token,
        signal: linked.controller.signal,
      });
    } catch (error) {
      const mayRetry = retryOnUnauthorized ?? method === "GET";
      if (
        !mayRetry ||
        !isApiError(error) ||
        error.kind !== "unauthorized" ||
        linked.controller.signal.aborted ||
        dependencies.logoutRequested()
      ) {
        throw error;
      }

      const refreshed = await dependencies.refreshSession("unauthorized");
      const replacementToken = dependencies.currentAccessToken();
      if (!refreshed || !replacementToken || dependencies.logoutRequested()) throw error;
      return apiRequest<T>({
        ...requestOptions,
        accessToken: replacementToken,
        signal: linked.controller.signal,
      });
    }
  } finally {
    dependencies.activeControllers().delete(linked.controller);
    linked.cleanup();
  }
}
