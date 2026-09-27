"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { BrowserLoginResponse } from "@/lib/api";

export type AuthSessionSnapshot =
  | Readonly<{ status: "anonymous" }>
  | Readonly<{
      status: "authenticated";
      email: string;
      accessExpiresAt: number;
      sessionExpiresAt: number;
    }>;

type AuthSessionContextValue = Readonly<{
  session: AuthSessionSnapshot;
  completeLogin: (email: string, response: BrowserLoginResponse) => void;
  clearSession: () => void;
  getAccessToken: () => string | null;
}>;

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const accessTokenRef = useRef<string | null>(null);
  const [session, setSession] = useState<AuthSessionSnapshot>({ status: "anonymous" });

  const completeLogin = useCallback((email: string, response: BrowserLoginResponse) => {
    const now = Date.now();
    accessTokenRef.current = response.access_token;
    setSession({
      status: "authenticated",
      email: email.trim().toLowerCase(),
      accessExpiresAt: now + response.expires_in * 1_000,
      sessionExpiresAt: now + response.session_expires_in * 1_000,
    });
  }, []);

  const clearSession = useCallback(() => {
    accessTokenRef.current = null;
    setSession({ status: "anonymous" });
  }, []);

  const getAccessToken = useCallback(() => accessTokenRef.current, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({ session, completeLogin, clearSession, getAccessToken }),
    [clearSession, completeLogin, getAccessToken, session],
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
