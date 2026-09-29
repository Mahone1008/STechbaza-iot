import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "./client";
import { apiConfig, buildApiUrl } from "./config";
import { formatSeen } from "./inventory";

afterEach(() => vi.unstubAllGlobals());

it.each(["//outside.invalid/path", "/\\outside.invalid/path", "/\t/outside.invalid", "https://outside.invalid", "/api/v1/auth/me#fragment"])("rejects unsafe API path before attaching credentials: %s", async (path) => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(apiRequest({ path, accessToken: "private-test-token" })).rejects.toThrow(/API/u);
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps valid paths on the configured backend and forbids redirects", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(buildApiUrl("/health").origin).toBe(apiConfig.baseUrl);
  expect(await apiRequest({ path: "/api/v1/auth/me", accessToken: "private-test-token" })).toEqual({ status: "ok" });
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  expect(options).toMatchObject({ credentials: "include", cache: "no-store", redirect: "error" });
  expect(new Headers(options.headers).get("Authorization")).toBe("Bearer private-test-token");
});

it("preserves date and timezone output while reusing formatters", () => {
  const value = "2026-01-15T12:34:56Z";
  for (const zone of ["UTC", "Europe/Kyiv", "America/New_York", "UTC", "Europe/Kyiv"]) {
    expect(formatSeen(value, zone)).toBe(new Intl.DateTimeFormat("uk-UA", { timeZone: zone, dateStyle: "short", timeStyle: "medium" }).format(new Date(value)));
  }
  expect(formatSeen(null)).toBe("Ще не було зв’язку");
  expect(formatSeen(value, "not-a-timezone")).toBe("2026-01-15T12:34:56.000Z (UTC)");
});
