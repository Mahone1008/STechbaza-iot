"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AUTH_CHANNEL_NAME,
  clearLogoutMarker,
  isSnapshotUsable,
  parseAuthChannelMessage,
  readRecentLogoutMarker,
  recordLogoutMarker,
  refreshDelayMs,
  refreshRetryDelayMs,
  withCrossTabAuthLock,
  type AuthChannelMessage,
  type AuthSessionSnapshotMessage,
} from "@/features/auth-coordination";
import {
  apiErrorDisplayMessage,
  browserLogin,
  browserLogout,
  clearAllSessionCaches,
  isApiError,
  type BrowserLoginRequest,
  type BrowserLoginResponse,
} from "@/lib/api";

import {
  DOCUMENT_TAB_ID,
  MAX_TIMER_DELAY_MS,
  MIN_ACCESS_VALIDITY_MS,
  MIN_PEER_TOKEN_VALIDITY_MS,
  PEER_RESPONSE_WINDOW_MS,
  coordinatedBrowserRefresh,
  authorizedApiRequest,
  type AuthorizedApiRequestOptions,
  isNewUsablePeerSnapshot,
  normalizeEmail,
  sessionOrigin,
  type AuthSessionContextValue,
  type AuthSessionSnapshot,
  type AuthenticatedSession,
  type LogoutFallback,
  type PeerSnapshotResolver,
  type RefreshReason,
  type SessionInvalidationReason,
} from "./auth-session-runtime";
export type { AuthSessionSnapshot, AuthenticatedSession, AuthorizedApiRequestOptions } from "./auth-session-runtime";

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSessionSnapshot>(() => ({ status: "restoring", startedAt: Date.now() }));
  const sessionRef = useRef<AuthSessionSnapshot>(session);
  const accessTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const latestPeerSnapshotRef = useRef<AuthSessionSnapshotMessage | null>(null);
  const lastEventAtRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const logoutPromiseRef = useRef<Promise<boolean> | null>(null);
  const logoutIntentRef = useRef(false);
  const logoutFallbackRef = useRef<LogoutFallback | null>(null);
  const activeRequestControllersRef = useRef(new Set<AbortController>());
  const peerWaitersRef = useRef(new Set<PeerSnapshotResolver>());
  const retryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const refreshNotBeforeRef = useRef(0);
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

  const resolvePeerWaiters = useCallback((snapshot: AuthSessionSnapshotMessage | null) => {
    for (const resolve of peerWaitersRef.current) resolve(snapshot);
    peerWaitersRef.current.clear();
  }, []);

  const abortAuthorizedRequests = useCallback(() => {
    for (const controller of activeRequestControllersRef.current) {
      controller.abort("logout");
    }
    activeRequestControllersRef.current.clear();
  }, []);

  const publishSnapshot = useCallback(
    (authenticated: AuthenticatedSession) => {
      const token = accessTokenRef.current;
      if (!token || logoutIntentRef.current || readRecentLogoutMarker() !== null) return;

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
    },
    [postMessage],
  );

  const applyTokenResponse = useCallback(
    (
      response: BrowserLoginResponse,
      options: Readonly<{
        email: string | null;
        source: "login" | "refresh";
        issuedAt: number;
        broadcast: boolean;
        force?: boolean;
      }>,
    ): boolean => {
      if (options.force) {
        clearLogoutMarker();
        logoutIntentRef.current = false;
        logoutFallbackRef.current = null;
      } else if (
        logoutIntentRef.current ||
        sessionRef.current.status === "logging-out" ||
        sessionRef.current.status === "logout-failed" ||
        readRecentLogoutMarker() !== null
      ) {
        return false;
      }

      if (!options.force && options.issuedAt < lastEventAtRef.current) return false;

      const now = Date.now();
      const current = sessionRef.current;
      const email = options.email ?? (current.status === "authenticated" ? current.email : null);
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
      refreshNotBeforeRef.current = 0;
      clearRetryTimer();
      commitSession(next);
      if (options.broadcast) publishSnapshot(next);
      return true;
    },
    [clearRetryTimer, commitSession, publishSnapshot],
  );

  const applyPeerSnapshot = useCallback(
    (snapshot: AuthSessionSnapshotMessage): boolean => {
      if (logoutIntentRef.current || readRecentLogoutMarker() !== null) return false;
      if (sessionRef.current.status === "logging-out" || sessionRef.current.status === "logout-failed") {
        return false;
      }
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
      refreshNotBeforeRef.current = 0;
      clearRetryTimer();
      commitSession(next);
      return true;
    },
    [clearRetryTimer, commitSession],
  );

  const clearSessionInternal = useCallback(
    (
      reason: "none" | "expired" | "revoked" | "logout",
      options: Readonly<{ broadcast: boolean; issuedAt?: number }> = { broadcast: false },
    ) => {
      const issuedAt = options.issuedAt ?? Date.now();
      if (issuedAt < lastEventAtRef.current) return;

      if (reason === "logout") recordLogoutMarker(issuedAt);
      logoutIntentRef.current = false;
      logoutFallbackRef.current = null;
      accessTokenRef.current = null;
      latestPeerSnapshotRef.current = null;
      lastEventAtRef.current = issuedAt;
      retryAttemptRef.current = 0;
      refreshNotBeforeRef.current = 0;
      clearRetryTimer();
      abortAuthorizedRequests();
      resolvePeerWaiters(null);
      commitSession({ status: "anonymous", reason });
      void clearAllSessionCaches(queryClient);

      if (options.broadcast && reason !== "none") {
        postMessage({
          version: 1,
          type: "session-cleared",
          sourceTab: DOCUMENT_TAB_ID,
          issuedAt,
          reason,
        });
      }
    },
    [abortAuthorizedRequests, clearRetryTimer, commitSession, postMessage, queryClient, resolvePeerWaiters],
  );

  const requestPeerSnapshot = useCallback((): Promise<AuthSessionSnapshotMessage | null> => {
    const channel = channelRef.current;
    if (!channel || logoutIntentRef.current || readRecentLogoutMarker() !== null) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

      const complete: PeerSnapshotResolver = (snapshot) => {
        if (settled) return;
        settled = true;
        if (timeout !== null) globalThis.clearTimeout(timeout);
        peerWaitersRef.current.delete(complete);
        resolve(snapshot);
      };

      peerWaitersRef.current.add(complete);
      channel.postMessage({
        version: 1,
        type: "session-request",
        sourceTab: DOCUMENT_TAB_ID,
        issuedAt: Date.now(),
      } satisfies AuthChannelMessage);
      timeout = globalThis.setTimeout(() => complete(null), PEER_RESPONSE_WINDOW_MS);
    });
  }, []);

  const scheduleRetry = useCallback(
    (error: unknown) => {
      if (logoutIntentRef.current) return;
      clearRetryTimer();
      const retryAfterSeconds = isApiError(error) ? error.retryAfterSeconds : null;
      const delay = refreshRetryDelayMs(retryAttemptRef.current, retryAfterSeconds);
      retryAttemptRef.current += 1;
      const retryAt = Date.now() + delay;
      refreshNotBeforeRef.current = retryAfterSeconds === null ? 0 : retryAt;

      const current = sessionRef.current;
      const tokenStillUsable =
        current.status === "authenticated" &&
        accessTokenRef.current !== null &&
        current.accessExpiresAt - Date.now() > MIN_PEER_TOKEN_VALIDITY_MS;
      const message = apiErrorDisplayMessage(error);

      if (tokenStillUsable && current.status === "authenticated") {
        commitSession({ ...current, refreshState: "degraded", refreshMessage: message });
      } else {
        commitSession({ status: "unavailable", message, retryAt });
      }

      retryTimerRef.current = globalThis.setTimeout(
        () => {
          retryTimerRef.current = null;
          void refreshSessionRef.current("retry");
        },
        Math.min(delay, MAX_TIMER_DELAY_MS),
      );
    },
    [clearRetryTimer, commitSession],
  );

  const commitApiRefresh = useCallback(
    (response: BrowserLoginResponse, issuedAt: number) => {
      const current = sessionRef.current;
      applyTokenResponse(response, {
        email: current.status === "authenticated" ? current.email : null,
        source: "refresh",
        issuedAt,
        broadcast: true,
      });
    },
    [applyTokenResponse],
  );

  const refreshSession = useCallback(
    (reason: RefreshReason = "demand"): Promise<boolean> => {
      void reason;
      if (
        logoutIntentRef.current ||
        sessionRef.current.status === "logging-out" ||
        sessionRef.current.status === "logout-failed" ||
        readRecentLogoutMarker() !== null
      ) {
        return Promise.resolve(false);
      }
      if (refreshPromiseRef.current) return refreshPromiseRef.current;

      // Manual retry, focus і demand не обходять cooldown після 429/503.
      const remainingCooldown = refreshNotBeforeRef.current - Date.now();
      if (remainingCooldown > 0) {
        if (retryTimerRef.current === null) {
          retryTimerRef.current = globalThis.setTimeout(
            () => {
              retryTimerRef.current = null;
              void refreshSessionRef.current("retry");
            },
            Math.min(remainingCooldown, MAX_TIMER_DELAY_MS),
          );
        }
        return Promise.resolve(false);
      }

      const baselineEventAt = lastEventAtRef.current;
      const request = (async () => {
        try {
          const outcome = await coordinatedBrowserRefresh(
            baselineEventAt,
            () => latestPeerSnapshotRef.current,
            requestPeerSnapshot,
            commitApiRefresh,
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
          if (isNewUsablePeerSnapshot(newerPeer, baselineEventAt)) {
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
    },
    [applyPeerSnapshot, applyTokenResponse, clearSessionInternal, commitApiRefresh, requestPeerSnapshot, scheduleRetry],
  );

  useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

  const login = useCallback(
    async (payload: BrowserLoginRequest, signal?: AbortSignal) => {
      await withCrossTabAuthLock(DOCUMENT_TAB_ID, async () => {
        logoutIntentRef.current = false;
        logoutFallbackRef.current = null;
        const response = await browserLogin(payload, signal);
        applyTokenResponse(response, {
          email: normalizeEmail(String(payload.email)),
          source: "login",
          issuedAt: Date.now(),
          broadcast: true,
          force: true,
        });
      });
    },
    [applyTokenResponse],
  );

  const logout = useCallback((): Promise<boolean> => {
    if (logoutPromiseRef.current) return logoutPromiseRef.current;

    const current = sessionRef.current;
    const token = accessTokenRef.current;
    if (current.status === "authenticated" && token) {
      logoutFallbackRef.current = { session: current, accessToken: token };
    }
    const fallback = logoutFallbackRef.current;

    logoutIntentRef.current = true;
    clearRetryTimer();
    abortAuthorizedRequests();
    resolvePeerWaiters(null);
    commitSession({
      status: "logging-out",
      startedAt: Date.now(),
      email: fallback?.session.email ?? null,
    });
    void clearAllSessionCaches(queryClient);

    const promise = withCrossTabAuthLock(DOCUMENT_TAB_ID, async () => {
      await browserLogout();
      const issuedAt = Date.now();
      clearSessionInternal("logout", { broadcast: true, issuedAt });
      return true;
    })
      .catch((error: unknown) => {
        // Відмова/timeout lock виникає до callback, тому обробляємо всю операцію.
        if (sessionRef.current.status === "anonymous" && sessionRef.current.reason === "logout") {
          return true;
        }

        logoutIntentRef.current = false;
        const retryAt =
          isApiError(error) && error.retryAfterSeconds !== null ? Date.now() + error.retryAfterSeconds * 1_000 : null;
        commitSession({
          status: "logout-failed",
          message: apiErrorDisplayMessage(error),
          retryAt,
          email: logoutFallbackRef.current?.session.email ?? null,
        });
        return false;
      })
      .finally(() => {
        logoutPromiseRef.current = null;
      });

    logoutPromiseRef.current = promise;
    return promise;
  }, [abortAuthorizedRequests, clearRetryTimer, clearSessionInternal, commitSession, queryClient, resolvePeerWaiters]);

  const cancelLogout = useCallback(() => {
    if (sessionRef.current.status !== "logout-failed") return;

    logoutIntentRef.current = false;
    const fallback = logoutFallbackRef.current;
    if (
      fallback &&
      fallback.session.sessionExpiresAt > Date.now() &&
      fallback.session.accessExpiresAt - Date.now() > MIN_PEER_TOKEN_VALIDITY_MS
    ) {
      accessTokenRef.current = fallback.accessToken;
      logoutFallbackRef.current = null;
      commitSession({ ...fallback.session, refreshState: "ready", refreshMessage: null });
      return;
    }

    logoutFallbackRef.current = null;
    commitSession({ status: "restoring", startedAt: Date.now() });
    void refreshSessionRef.current("demand");
  }, [commitSession]);

  const clearSession = useCallback(
    (reason: SessionInvalidationReason = "revoked") => {
      clearSessionInternal(reason, { broadcast: true });
    },
    [clearSessionInternal],
  );

  const getAccessToken = useCallback(
    async (minimumValidityMs = MIN_ACCESS_VALIDITY_MS) => {
      if (logoutIntentRef.current) return null;
      const current = sessionRef.current;
      const token = accessTokenRef.current;
      if (current.status === "authenticated" && token && current.accessExpiresAt - Date.now() > minimumValidityMs) {
        return token;
      }

      const refreshed = await refreshSession("demand");
      return refreshed && !logoutIntentRef.current ? accessTokenRef.current : null;
    },
    [refreshSession],
  );

  const authorizedRequest = useCallback(
    <T,>(options: AuthorizedApiRequestOptions) =>
      authorizedApiRequest<T>(
        {
          activeControllers: () => activeRequestControllersRef.current,
          logoutRequested: () => logoutIntentRef.current,
          currentAccessToken: () => accessTokenRef.current,
          getAccessToken,
          refreshSession,
        },
        options,
      ),
    [getAccessToken, refreshSession],
  );

  useEffect(() => {
    mountedRef.current = true;
    const peerWaiters = peerWaitersRef.current;
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
            !logoutIntentRef.current &&
            readRecentLogoutMarker() === null &&
            current.status === "authenticated" &&
            token &&
            current.accessExpiresAt - Date.now() > MIN_PEER_TOKEN_VALIDITY_MS
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
          resolvePeerWaiters(message);
          applyPeerSnapshot(message);
          return;
        }

        if (message.issuedAt >= lastEventAtRef.current) {
          clearSessionInternal(message.reason, { broadcast: false, issuedAt: message.issuedAt });
        }
      });
    }

    void (async () => {
      const logoutAt = readRecentLogoutMarker();
      if (logoutAt !== null) {
        clearSessionInternal("logout", { broadcast: false, issuedAt: logoutAt });
        return;
      }

      const peerSnapshot = await requestPeerSnapshot();
      if (!mountedRef.current) return;
      if (peerSnapshot && applyPeerSnapshot(peerSnapshot)) return;
      await refreshSession("startup");
    })();

    return () => {
      mountedRef.current = false;
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
      for (const resolve of peerWaiters) resolve(null);
      peerWaiters.clear();
      clearRetryTimer();
      abortAuthorizedRequests();
    };
  }, [
    abortAuthorizedRequests,
    applyPeerSnapshot,
    clearRetryTimer,
    clearSessionInternal,
    refreshSession,
    requestPeerSnapshot,
    resolvePeerWaiters,
  ]);

  useEffect(() => {
    if (session.status !== "authenticated") return;

    const timer = globalThis.setTimeout(() => void refreshSession("timer"), refreshDelayMs(session.accessExpiresAt));
    return () => globalThis.clearTimeout(timer);
  }, [refreshSession, session]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || logoutIntentRef.current) return;
      const current = sessionRef.current;
      if (current.status === "authenticated" && current.accessExpiresAt - Date.now() <= MIN_ACCESS_VALIDITY_MS) {
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
      logout,
      cancelLogout,
      refreshSession,
      clearSession,
      getAccessToken,
      authorizedRequest,
    }),
    [authorizedRequest, cancelLogout, clearSession, getAccessToken, login, logout, refreshSession, session],
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
