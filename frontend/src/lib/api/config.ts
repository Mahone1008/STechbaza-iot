const DEFAULT_API_BASE_URL = "http://127.0.0.1:8001";
const DEFAULT_API_TIMEOUT_MS = 10_000;
const MIN_API_TIMEOUT_MS = 1_000;
const MAX_API_TIMEOUT_MS = 60_000;

function normalizeApiBaseUrl(value: string | undefined): string {
  const rawValue = value?.trim() || DEFAULT_API_BASE_URL;
  let parsed: URL;

  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must not contain credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must not contain query or fragment values.");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath && normalizedPath !== "/api/v1") {
    throw new Error("NEXT_PUBLIC_API_BASE_URL may contain only the optional /api/v1 suffix.");
  }

  return parsed.origin;
}

function normalizeTimeout(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_API_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_API_TIMEOUT_MS || parsed > MAX_API_TIMEOUT_MS) {
    throw new Error(
      `NEXT_PUBLIC_API_TIMEOUT_MS must be an integer from ${MIN_API_TIMEOUT_MS} to ${MAX_API_TIMEOUT_MS}.`,
    );
  }
  return parsed;
}

export const apiConfig = Object.freeze({
  baseUrl: normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
  timeoutMs: normalizeTimeout(process.env.NEXT_PUBLIC_API_TIMEOUT_MS),
  apiPrefix: "/api/v1",
});

export function buildApiUrl(path: string): URL {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with '/': ${path}`);
  }
  return new URL(path, `${apiConfig.baseUrl}/`);
}
