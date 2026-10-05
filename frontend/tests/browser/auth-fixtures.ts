import { seriesFixture } from "../fixtures/series";
import { overviewFixture } from "../fixtures/overview";
import type { BrowserContext, Page, Route } from "@playwright/test";

export const API_ORIGIN = "http://127.0.0.1:8001";
export const FRONTEND_ORIGIN = "http://127.0.0.1:3000";
export const LOGIN_URL = `${API_ORIGIN}/api/v1/auth/browser/login`;
export const REFRESH_URL = `${API_ORIGIN}/api/v1/auth/browser/refresh`;
export const LOGOUT_URL = `${API_ORIGIN}/api/v1/auth/browser/logout`;
export const ME_URL = `${API_ORIGIN}/api/v1/auth/me`;
export const ORGANIZATIONS_URL = `${API_ORIGIN}/api/v1/organizations`;
export const ORGANIZATION_ID = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
export const ACCESS_URL = `${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/access`;
export const SITE_ID = "739512a9-6ddb-4f8e-99e9-211c8553651e";
export const DEVICE_ID = "a8f2f2d6-e380-492a-a9dc-d0b9ba792136";
export const SITES_URL = `${ORGANIZATIONS_URL}/${ORGANIZATION_ID}/sites`;
export const DEVICES_URL = `${API_ORIGIN}/api/v1/sites/${SITE_ID}/devices`;
export const USER_ID = "0f4ac4a8-6a1d-4d4b-9f91-4c9d5d1a8b31";
export const SESSION_ID = "4df58667-7a29-47f8-b6d6-055e47717680";

export const ownerPermissions = [
  "organization.read",
  "site.read",
  "site.create",
  "device.read",
  "device.create",
  "telemetry.read",
  "event.read",
  "alarm.read",
  "notification.read",
  "alarm.acknowledge",
  "command.read",
  "command.execute",
  "capability.read",
  "capability.manage",
  "membership.read",
  "membership.manage",
] as const;

export const viewerPermissions = [
  "organization.read",
  "site.read",
  "device.read",
  "telemetry.read",
  "event.read",
  "alarm.read",
  "notification.read",
  "command.read",
  "capability.read",
] as const;

export const corsHeaders = {
  "access-control-allow-origin": FRONTEND_ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-techbaza-csrf",
  "access-control-expose-headers": "Retry-After",
  vary: "Origin",
};

type RouteTarget = Page | BrowserContext;
type OrganizationRole = "owner" | "admin" | "operator" | "viewer" | "service";

type IdentityOptions = Readonly<{
  email?: string;
  displayName?: string;
  role?: OrganizationRole;
  permissions?: readonly string[];
  organizationName?: string;
  organizationActive?: boolean;
  memberships?: readonly Readonly<{ organization_id: string; role: OrganizationRole }>[];
  organizations?: readonly Record<string, unknown>[];
  meStatus?: number;
  accessStatus?: number;
  organizationStatus?: number;
  meNetworkFailure?: boolean;
}>;

export function tokenPayload(seed: string) {
  return {
    access_token: `header.${seed.repeat(80)}.signature`,
    token_type: "bearer",
    expires_in: 900,
    session_expires_in: 2_592_000,
  } as const;
}

export function currentUserPayload(options: IdentityOptions = {}) {
  const role = options.role ?? "owner";
  return {
    id: USER_ID,
    email: options.email ?? "owner@example.com",
    display_name: options.displayName ?? "Owner",
    platform_role: "user",
    is_active: true,
    auth_session_id: SESSION_ID,
    auth_session_expires_at: "2026-10-27T12:00:00Z",
    memberships: options.memberships ?? [{ organization_id: ORGANIZATION_ID, role }],
  };
}

export function organizationPayload(options: IdentityOptions = {}) {
  return {
    id: ORGANIZATION_ID,
    name: options.organizationName ?? "DEMO: клієнт A",
    slug: "techbaza-demo-a",
    is_active: options.organizationActive ?? true,
    created_at: "2026-09-27T12:00:00Z",
    updated_at: "2026-09-27T12:00:00Z",
  };
}

export function accessPayload(options: IdentityOptions = {}) {
  const role = options.role ?? "owner";
  return {
    organization_id: ORGANIZATION_ID,
    platform_role: "user",
    organization_role: role,
    permissions: options.permissions ?? (role === "viewer" ? viewerPermissions : ownerPermissions),
  };
}

export async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
}

export async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function mockMissingBrowserSession(target: RouteTarget): Promise<void> {
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 401, { detail: "Браузерна сесія недійсна або завершилася" });
  });
}

export async function mockRefreshSuccess(
  target: RouteTarget,
  seed = "r",
  onRequest: (() => void) | null = null,
): Promise<void> {
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    onRequest?.();
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "set-cookie": `techbaza_refresh=${seed.repeat(64)}; Path=/api/v1/auth/browser; HttpOnly; SameSite=Strict`,
      },
      body: JSON.stringify(tokenPayload(seed)),
    });
  });
}

export async function mockBrowserLoginSuccess(
  target: RouteTarget,
  options: Readonly<{ seed?: string; onRequest?: ((route: Route) => void) | null }> = {},
): Promise<void> {
  const seed = options.seed ?? "l";
  await target.route(LOGIN_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    options.onRequest?.(route);
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "set-cookie": `techbaza_refresh=${seed.repeat(64)}; Path=/api/v1/auth/browser; HttpOnly; SameSite=Strict`,
      },
      body: JSON.stringify(tokenPayload(seed)),
    });
  });
}

export async function mockBrowserLogoutSuccess(
  target: RouteTarget,
  onRequest: ((route: Route) => void) | null = null,
): Promise<void> {
  await target.route(LOGOUT_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    onRequest?.(route);
    await route.fulfill({
      status: 204,
      headers: {
        ...corsHeaders,
        "set-cookie": "techbaza_refresh=; Path=/api/v1/auth/browser; Max-Age=0; HttpOnly; SameSite=Strict",
      },
      body: "",
    });
  });
}

export function sitePayload() {
  return { id: SITE_ID, organization_id: ORGANIZATION_ID, name: "Тестовий об’єкт", code: "SITE-1", timezone: "Europe/Kyiv", created_at: "2026-09-27T12:00:00Z", updated_at: "2026-09-27T12:00:00Z" };
}
export function devicePayload(index = 0) {
  return { id: index === 0 ? DEVICE_ID : `a8f2f2d6-e380-492a-a9dc-${String(index).padStart(12, "0")}`, site_id: SITE_ID, name: index === 0 ? "Насосна станція №1" : `Контролер ${index}`, uid: `TB-TEST-${index}`, device_type: "modular_controller", lifecycle_status: "active", last_seen_at: "2026-09-27T12:00:00Z", created_at: "2026-09-27T12:00:00Z", updated_at: "2026-09-27T12:00:00Z" };
}
export function availabilityPayload(device = devicePayload()) {
  return { device_id: device.id, uid: device.uid, online: true, last_seen_at: device.last_seen_at, timeout_seconds: 90, seconds_since_seen: 10 };
}
export async function mockIdentity(target: RouteTarget, options: IdentityOptions = {}): Promise<void> {
  await target.route(`${ORGANIZATIONS_URL}/${ORGANIZATION_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, organizationPayload(options));
  });
  await target.route(`${SITES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, [sitePayload()]);
  });
  await target.route(`${API_ORIGIN}/api/v1/sites/${SITE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, sitePayload());
  });
  await target.route(`${DEVICES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, [devicePayload()]);
  });
  await target.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, devicePayload());
  });
  await target.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/availability`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, availabilityPayload());
  });
  await target.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const body = overviewFixture(devicePayload());
    await fulfillJson(route, 200, { ...body, access: accessPayload(options) });
  });
  await target.route(ME_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    if (options.meNetworkFailure) {
      await route.abort("failed");
      return;
    }
    const status = options.meStatus ?? 200;
    await fulfillJson(route, status, status === 200 ? currentUserPayload(options) : { detail: "Недоступно" });
  });

  await target.route(new RegExp(`^${ORGANIZATIONS_URL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\?.*)?$`, "u"), async (route) => {
    if (await fulfillPreflight(route)) return;
    const status = options.organizationStatus ?? 200;
    const organizations = options.organizations ?? [organizationPayload(options)];
    await fulfillJson(route, status, status === 200 ? organizations : { detail: "Недоступно" });
  });

  await target.route(ACCESS_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    const status = options.accessStatus ?? 200;
    await fulfillJson(route, status, status === 200 ? accessPayload(options) : { detail: "Недостатньо прав" });
  });
}

export async function mockAuthenticatedWorkspace(
  target: RouteTarget,
  options: IdentityOptions = {},
): Promise<void> {
  await mockRefreshSuccess(target);
  await mockIdentity(target, options);
  await target.route(`${API_ORIGIN}/api/v1/devices/*/commands?*`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, []); });
  await target.route(`${API_ORIGIN}/api/v1/devices/*/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const url = new URL(route.request().url());
    await fulfillJson(route, 200, seriesFixture({ start: url.searchParams.get("start")!, end: url.searchParams.get("end")!, bucket_seconds: Number(url.searchParams.get("bucket_seconds")) }, url.searchParams.get("metric")!, url.pathname.split("/")[4]));
  });
}

export async function fillLogin(
  page: Page,
  email = "owner@example.com",
  password = "valid-test-password",
): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
}
