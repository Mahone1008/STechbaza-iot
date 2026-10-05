import type { components, paths } from "./schema";
import { apiRequest } from "./client";
import { buildApiUrl } from "./config";
import { ApiError } from "./errors";

export type HealthResponse = paths["/health"]["get"]["responses"][200]["content"]["application/json"];
export type BrowserLoginRequest = components["schemas"]["LoginRequest"];
export type BrowserLoginResponse = components["schemas"]["BrowserTokenResponse"];

const BROWSER_LOGIN_PATH = "/api/v1/auth/browser/login";
const BROWSER_REFRESH_PATH = "/api/v1/auth/browser/refresh";
const BROWSER_LOGOUT_PATH = "/api/v1/auth/browser/logout";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function parseBrowserTokenResponse(
  value: unknown,
  path: string,
  operation: "входу" | "оновлення сесії",
): BrowserLoginResponse {
  if (isRecord(value)) {
    const accessToken = value.access_token;
    const tokenType = value.token_type;
    const expiresIn = parsePositiveInteger(value.expires_in);
    const sessionExpiresIn = parsePositiveInteger(value.session_expires_in);

    if (
      typeof accessToken === "string" &&
      accessToken.length >= 20 &&
      accessToken.length <= 8_192 &&
      tokenType === "bearer" &&
      expiresIn !== null &&
      sessionExpiresIn !== null &&
      (value.onboarding_path == null ||
        (typeof value.onboarding_path === "string" && /^\/connect\/[0-9a-f-]{36}$/u.test(value.onboarding_path)))
    ) {
      return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: expiresIn,
        session_expires_in: sessionExpiresIn,
        ...(typeof value.onboarding_path === "string" ? { onboarding_path: value.onboarding_path } : {}),
      };
    }
  }

  throw new ApiError(`Backend повернув некоректну відповідь ${operation}.`, {
    kind: "invalid-response",
    status: 200,
    method: "POST",
    url: buildApiUrl(path).toString(),
    retryAfterSeconds: null,
    requestId: null,
    details: { expected: "BrowserTokenResponse" },
  });
}

export function getBackendHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>({
    path: "/health",
    timeoutMs: 5_000,
    ...(signal ? { signal } : {}),
  });
}

export async function browserLogin(payload: BrowserLoginRequest, signal?: AbortSignal): Promise<BrowserLoginResponse> {
  const response = await apiRequest<unknown>({
    path: BROWSER_LOGIN_PATH,
    method: "POST",
    body: payload,
    csrf: true,
    credentials: "include",
    ...(signal ? { signal } : {}),
  });

  return parseBrowserTokenResponse(response, BROWSER_LOGIN_PATH, "входу");
}

export async function browserRefresh(signal?: AbortSignal): Promise<BrowserLoginResponse> {
  const response = await apiRequest<unknown>({
    path: BROWSER_REFRESH_PATH,
    method: "POST",
    csrf: true,
    credentials: "include",
    ...(signal ? { signal } : {}),
  });

  return parseBrowserTokenResponse(response, BROWSER_REFRESH_PATH, "оновлення сесії");
}

export async function browserLogout(signal?: AbortSignal): Promise<void> {
  await apiRequest<null>({
    path: BROWSER_LOGOUT_PATH,
    method: "POST",
    csrf: true,
    credentials: "include",
    ...(signal ? { signal } : {}),
  });
}
