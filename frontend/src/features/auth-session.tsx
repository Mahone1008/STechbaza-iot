"use client";

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

import {
  AUTH_CHANNEL_NAME,
  createAuthTabId,
  isSnapshotUsable,
  parseAuthChannelMessage,
  refreshDelayMs,
  refreshRetryDelayMs,
  withCrossTabAuthLock,
  type AuthChannelMessage,
  type AuthSessionSnapshotMessage,
} from "@/features/auth-coordination";
import {
  ApiError,
  apiErrorDisplayMessage,
  apiRequest,
  browserLogin,
  browserRefresh,
  isApiError,
  type ApiRequestOptions,
  type BrowserLoginRequest,
  type BrowserLoginResponse,
} from "@/lib/api";

const DOCUMENT_TAB_ID = createAuthTabId();
const PEER_RESPONSE_WINDOW_MS = 250;
const MIN_ACCESS_VALIDITY_MS = 30_000;
const MIN_PEER_TOKEN_VALIDITY_MS = 5_000;

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
  | Readonly<{ status: "anonymous"; reason: "none" | "expired" | "revoked" }>
  | AuthenticatedSession
  | Readonly<{ status: "unavailable"; message: string; retryAt: number | null }>;

export type AuthorizedApiRequestOptions = Omit<ApiRequestOptions, "accessToken"> & Readonly<{
  retryOnUnauthorized?: boolean;
}>;

type RefreshReason = "startup" | "timer" | "visibility" | "demand" | "unauthorized" | "retry";

type AuthSessionContextValue = Readonly<{
  session: AuthSessionSnapshot;
  login: (payload: BrowserLoginRequest, signal?: AbortSignal) => Promise<void>;
  refreshSession: (reason?: RefreshReason) => Promise<boolean>;
  clearSession: () => void;
  getAccessToken: (minimumValidityMs?: number) => Promise<string | null>;
  authorizedRequest: <T>(options: AuthorizedApiRequestOptions) => Promise<T>;
}>;

type RefreshOutcome =
  | Readonly<{ kind: "peer"; snapshot: AuthSessionSnapshotMessage }>
  | Readonly<{ kind: "api"; response: BrowserLoginResponse; issuedAt: number }>;

let sameDocumentRefreshPromise: Promise<RefreshOutcome> | null = null;

async function coordinatedBrowserRefresh(
  requestedAt: number,
  getLatestPeerSnapshot: () => AuthSessionSnapshotMessage | null,
  announceRefresh: (response: BrowserLoginResponse, issuedAt: number) => void,
): Promise<RefreshOutcome> {
  if (sameDocumentRefreshPromise) return sameDocumentRefreshPromise;

  const promise = withCrossTabAuthLock(DOCUMENT_TAB_ID, async () => {
    const peerSnapshot = getLatestPeerSnapshot();
    if (
      peerSnapshot
      && peerSnapshot.issuedAt >= requestedAt
      && isSnapshotUsable(peerSnapshot, Date.now(), MIN_PEER_TOKEN_VALIDITY_MS)
    ) {
      return { kind: "peer", snapshot: peerSnapshot } as const;
    }

    const response = await browserRefresh();
    const issuedAt = Date.now();
    announceRefresh(response, issuedAt);
    return { kind: "api", response, issuedAt } as const;
  }).finally(() => {
    sameDocumentRefreshPromise = null;
  });
  sameDocumentRefreshPromise = promise;
  return promise;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sessionOrigin(session: AuthenticatedSession): "login" | "refresh" {
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

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<AuthSessionSnapshot>(
    () => ({ status: "restoring", startedAt: Date.now() }),
  );
  const sessionRef = useRef<AuthSessionSnapshot>(session);
  const accessTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const latestPeerSnapshotRef = useRef<AuthSessionSnapshotMessage | null>(null);
  const lastEventAtRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const peerWaitersRef = useRef(new Set<(found: boolean) => void>());
  const retryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const refreshSessionRef = useRef<(reason?: RefreshReason) => Promise<boolean>>(async () => false);

  const commitSession = useCallback((next: AuthSessionSnapshot) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
  }, []);

  const postMessage = useCallback((message: AuthChannelMessage) => {
    channelRef.current?.postMessage(message);
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      globalThis.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const publishSnapshot = useCallback((authenticated: AuthenticatedSession) => {
    const token = accessTokenRef.current;
    if (!token) return;

    postMessage({
      version: 1,
      type: "session-snapshot",
      sourceTab: DOCUMENT_TAB_ID,
      targetTab: null,
      issuedAt: lastEventAtRef.current,
      sessionOrigin: sessionOrigin(authenticated),
      email: authenticated.email,
      accessToken: token,
      accessExpiresAt: authenticated.accessExpiresAt,
      sessionExpiresAt: authenticated.sessionExpiresAt,
    });
  }, [postMessage]);

  const applyTokenResponse = useCallback((
    response: BrowserLoginResponse,
    options: Readonly<{
      email: string | null;
      source: "login" | "refresh";
      issuedAt: number;
      broadcast: boolean;
      force?: boolean;
    }>,
  ): boolean => {
    if (!options.force && options.issuedAt < lastEventAtRef.current) return false;

    const now = Date.now();
    const current = sessionRef.current;
    const email = options.email
      ?? (current.status === "authenticated" ? current.email : null);
    const next: AuthenticatedSession = {
      status: "authenticated",
      email,
      accessExpiresAt: now + response.expires_in * 1_000,
      sessionExpiresAt: now + response.session_expires_in * 1_000,
      source: options.source,
      refreshState: "ready",
      refreshMessage: null,
    };

    accessTokenRef.current = response.access_token;
    lastEventAtRef.current = options.issuedAt;
    retryAttemptRef.current = 0;
    clearRetryTimer();
    commitSession(next);
    if (options.broadcast) publishSnapshot(next);
    return true;
  }, [clearRetryTimer, commitSession, publishSnapshot]);

  const announceRefresh = useCallback((response: BrowserLoginResponse, issuedAt: number) => {
    const current = sessionRef.current;
    postMessage({
      version: 1,
      type: "session-snapshot",
      sourceTab: DOCUMENT_TAB_ID,
      targetTab: null,
      issuedAt,
      sessionOrigin: "refresh",
      email: current.status === "authenticated" ? current.email : null,
      accessToken: response.access_token,
      accessExpiresAt: issuedAt + response.expires_in * 1_000,
      sessionExpiresAt: issuedAt + response.session_expires_in * 1_000,
    });
  }, [postMessage]);

  const applyPeerSnapshot = useCallback((snapshot: AuthSessionSnapshotMessage): boolean => {
    if (!isSnapshotUsable(snapshot, Date.now(), MIN_PEER_TOKEN_VALIDITY_MS)) return false;
    if (snapshot.issuedAt < lastEventAtRef.current) return false;

    const current = sessionRef.current;
    const next: AuthenticatedSession = {
      status: "authenticated",
      email: snapshot.email ?? (current.status === "authenticated" ? current.email : null),
      accessExpiresAt: snapshot.accessExpiresAt,
      sessionExpiresAt: snapshot.sessionExpiresAt,
      source: "peer",
      refreshState: "ready",
      refreshMessage: null,
    };

    accessTokenRef.current = snapshot.accessToken;
    latestPeerSnapshotRef.current = snapshot;
    lastEventAtRef.current = snapshot.issuedAt;
    retryAttemptRef.current = 0;
    clearRetryTimer();
    commitSession(next);
    for (const resolve of peerWaitersRef.current) resolve(true);
    peerWaitersRef.current.clear();
    return true;
  }, [clearRetryTimer, commitSession]);

  const clearSessionInternal = useCallback((
    reason: "none" | "expired" | "revoked",
    options: Readonly<{ broadcast: boolean; issuedAt?: number }> = { broadcast: false },
  ) => {
    const issuedAt = options.issuedAt ?? Date.now();
    if (issuedAt < lastEventAtRef.current) return;

    accessTokenRef.current = null;
    latestPeerSnapshotRef.current = null;
    lastEventAtRef.current = issuedAt;
    retryAttemptRef.current = 0;
    clearRetryTimer();
    commitSession({ status: "anonymous", reason });

    if (options.broadcast && reason !== "none") {
      postMessage({
        version: 1,
        type: "session-cleared",
        sourceTab: DOCUMENT_TAB_ID,
        issuedAt,
        reason,
      });
    }
  }, [clearRetryTimer, commitSession, postMessage]);

  const scheduleRetry = useCallback((error: unknown) => {
    clearRetryTimer();
    const retryAfterSeconds = isApiError(error) ? error.retryAfterSeconds : null;
    const delay = refreshRetryDelayMs(retryAttemptRef.current, retryAfterSeconds);
    retryAttemptRef.current += 1;
    const retryAt = Date.now() + delay;

    const current = sessionRef.current;
    const tokenStillUsable = current.status === "authenticated"
      && accessTokenRef.current !== null
      && current.accessExpiresAt - Date.now() > MIN_PEER_TOKEN_VALIDITY_MS;
    const message = apiErrorDisplayMessage(error);

    if (tokenStillUsable && current.status === "authenticated") {
      commitSession({ ...current, refreshState: "degraded", refreshMessage: message });
    } else {
      commitSession({ status: "unavailable", message, retryAt });
    }

    retryTimerRef.current = globalThis.setTimeout(() => {
      retryTimerRef.current = null;
      void refreshSessionRef.current("retry");
    }, delay);
  }, [clearRetryTimer, commitSession]);

  const refreshSession = useCallback((reason: RefreshReason = "demand"): Promise<boolean> => {
    void reason;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const requestedAt = Date.now();
    const request = (async () => {
      try {
        const outcome = await coordinatedBrowserRefresh(
          requestedAt,
          () => latestPeerSnapshotRef.current,
          announceRefresh,
        );

        if (outcome.kind === "peer") {
          return applyPeerSnapshot(outcome.snapshot);
        }

        const current = sessionRef.current;
        return applyTokenResponse(outcome.response, {
          email: current.status === "authenticated" ? current.email : null,
          source: "refresh",
          issuedAt: outcome.issuedAt,
          broadcast: false,
        });
      } catch (error) {
        const newerPeer = latestPeerSnapshotRef.current;
        if (
          newerPeer
          && newerPeer.issuedAt >= requestedAt
          && isSnapshotUsable(newerPeer, Date.now(), MIN_PEER_TOKEN_VALIDITY_MS)
        ) {
          return applyPeerSnapshot(newerPeer);
        }

        if (isApiError(error) && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          clearSessionInternal(error.kind === "forbidden" ? "revoked" : "expired", { broadcast: true });
          return false;
        }
        if (isApiError(error) && error.kind === "aborted") return false;

        scheduleRetry(error);
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = request;
    return request;
  }, [announceRefresh, applyPeerSnapshot, applyTokenResponse, clearSessionInternal, scheduleRetry]);

  useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

  const login = useCallback(async (payload: BrowserLoginRequest, signal?: AbortSignal) => {
    await withCrossTabAuthLock(DOCUMENT_TAB_ID, async () => {
      const response = await browserLogin(payload, signal);
      applyTokenResponse(response, {
        email: normalizeEmail(String(payload.email)),
        source: "login",
        issuedAt: Date.now(),
        broadcast: true,
        force: true,
      });
    });
  }, [applyTokenResponse]);

  const clearSession = useCallback(() => clearSessionInternal("none"), [clearSessionInternal]);

  const getAccessToken = useCallback(async (minimumValidityMs = MIN_ACCESS_VALIDITY_MS) => {
    const current = sessionRef.current;
    const token = accessTokenRef.current;
    if (
      current.status === "authenticated"
      && token
      && current.accessExpiresAt - Date.now() > minimumValidityMs
    ) {
      return token;
    }

    const refreshed = await refreshSession("demand");
    return refreshed ? accessTokenRef.current : null;
  }, [refreshSession]);

  const authorizedRequest = useCallback(async <T,>(options: AuthorizedApiRequestOptions): Promise<T> => {
    const { retryOnUnauthorized, ...requestOptions } = options;
    const token = await getAccessToken();
    if (!token) throw noAccessTokenError(options.path);

    try {
      return await apiRequest<T>({ ...requestOptions, accessToken: token });
    } catch (error) {
      const method = options.method ?? "GET";
      const mayRetry = retryOnUnauthorized ?? method === "GET";
      if (
        !mayRetry
        || !isApiError(error)
        || error.kind !== "unauthorized"
        || options.signal?.aborted
      ) {
        throw error;
      }

      const refreshed = await refreshSession("unauthorized");
      const replacementToken = accessTokenRef.current;
      if (!refreshed || !replacementToken) throw error;
      return apiRequest<T>({ ...requestOptions, accessToken: replacementToken });
    }
  }, [getAccessToken, refreshSession]);

  const waitForPeerSnapshot = useCallback((): Promise<boolean> => {
    const channel = channelRef.current;
    if (!channel) return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      const complete = (found: boolean) => {
        if (settled) return;
        settled = true;
        peerWaitersRef.current.delete(complete);
        resolve(found);
      };

      peerWaitersRef.current.add(complete);
      channel.postMessage({
        version: 1,
        type: "session-request",
        sourceTab: DOCUMENT_TAB_ID,
        issuedAt: Date.now(),
      } satisfies AuthChannelMessage);
      globalThis.setTimeout(() => complete(false), PEER_RESPONSE_WINDOW_MS);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let channel: BroadcastChannel | null = null;

    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
      channelRef.current = channel;
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        const message = parseAuthChannelMessage(event.data);
        if (!message || message.sourceTab === DOCUMENT_TAB_ID) return;

        if (message.type === "session-request") {
          const current = sessionRef.current;
          const token = accessTokenRef.current;
          if (
            current.status === "authenticated"
            && token
            && current.accessExpiresAt - Date.now() > MIN_PEER_TOKEN_VALIDITY_MS
          ) {
            channel?.postMessage({
              version: 1,
              type: "session-snapshot",
              sourceTab: DOCUMENT_TAB_ID,
              targetTab: message.sourceTab,
              issuedAt: lastEventAtRef.current || Date.now(),
              sessionOrigin: sessionOrigin(current),
              email: current.email,
              accessToken: token,
              accessExpiresAt: current.accessExpiresAt,
              sessionExpiresAt: current.sessionExpiresAt,
            } satisfies AuthChannelMessage);
          }
          return;
        }

        if (message.type === "session-snapshot") {
          if (message.targetTab !== null && message.targetTab !== DOCUMENT_TAB_ID) return;
          latestPeerSnapshotRef.current = message;
          applyPeerSnapshot(message);
          return;
        }

        if (message.issuedAt >= lastEventAtRef.current) {
          clearSessionInternal(
            message.reason === "expired" ? "expired" : "revoked",
            { broadcast: false, issuedAt: message.issuedAt },
          );
        }
      });
    }

    void (async () => {
      const restoredFromPeer = await waitForPeerSnapshot();
      if (!mountedRef.current) return;
      if (restoredFromPeer && sessionRef.current.status === "authenticated") return;
      await refreshSession("startup");
    })();

    return () => {
      mountedRef.current = false;
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
      for (const resolve of peerWaitersRef.current) resolve(false);
      peerWaitersRef.current.clear();
      clearRetryTimer();
    };
  }, [applyPeerSnapshot, clearRetryTimer, clearSessionInternal, refreshSession, waitForPeerSnapshot]);

  useEffect(() => {
    if (session.status !== "authenticated") return;

    const timer = globalThis.setTimeout(
      () => void refreshSession("timer"),
      refreshDelayMs(session.accessExpiresAt),
    );
    return () => globalThis.clearTimeout(timer);
  }, [refreshSession, session]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = sessionRef.current;
      if (
        current.status === "authenticated"
        && current.accessExpiresAt - Date.now() <= MIN_ACCESS_VALIDITY_MS
      ) {
        void refreshSession("visibility");
      }
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [refreshSession]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      session,
      login,
      refreshSession,
      clearSession,
      getAccessToken,
      authorizedRequest,
    }),
    [authorizedRequest, clearSession, getAccessToken, login, refreshSession, session],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  }
  return context;
}
