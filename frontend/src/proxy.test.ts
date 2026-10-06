import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

it("blocks internal previews by default, including nested routes, with private security headers", () => {
  vi.stubEnv("KERUMO_UI_PREVIEW", "");
  for (const path of ["/ui-kit", "/ui-kit/device-demo?source=old-link"]) {
    const request = new NextRequest(`http://127.0.0.1:3000${path}`);
    const response = proxy(request);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(new URL("/_not-found", request.url).toString());
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("'strict-dynamic'");
  }
  expect(proxy(new NextRequest("http://127.0.0.1:3000/devices")).status).toBe(200);
});

it("allows explicitly enabled development previews", () => {
  vi.stubEnv("KERUMO_UI_PREVIEW", "1");
  expect(proxy(new NextRequest("http://127.0.0.1:3000/ui-kit/device-demo")).headers.has("x-middleware-rewrite")).toBe(
    false,
  );
});

it("separates private operations, manufacturing and customer onboarding routes", () => {
  for (const [portal, hidden, visible] of [
    ["customer", ["/operations", "/operations/users", "/factory"], ["/register", "/connect", "/devices"]],
    [
      "staff",
      ["/register", "/register/verify", "/connect", "/invite"],
      ["/operations", "/factory", "/account/security"],
    ],
  ] as const) {
    vi.stubEnv("NEXT_PUBLIC_PORTAL_MODE", portal);
    for (const path of hidden) expect(proxy(new NextRequest(`http://127.0.0.1:3000${path}`)).status).toBe(404);
    for (const path of visible) expect(proxy(new NextRequest(`http://127.0.0.1:3000${path}`)).status).toBe(200);
  }
});
