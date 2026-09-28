import { expect, test, type Page } from "@playwright/test";
import {
  API_ORIGIN, ORGANIZATION_ID, ORGANIZATIONS_URL, SITE_ID, SITES_URL, DEVICE_ID, DEVICES_URL,
  SESSION_ID, USER_ID, accessPayload, availabilityPayload, devicePayload, fulfillJson, fulfillPreflight,
  mockAuthenticatedWorkspace, mockBrowserLoginSuccess, mockBrowserLogoutSuccess, mockMissingBrowserSession, fillLogin, organizationPayload, sitePayload,
} from "./auth-fixtures";

const tenantPath = `/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}/devices`;
const otherOrg = "0115f25c-ed62-42cc-95bc-a1b4b3669755";
const otherSite = "d9c4f8a6-f57d-43e2-a2e3-f10669e4a39c";

async function devices(page: Page, rows: ReturnType<typeof devicePayload>[]) {
  await page.route(`${DEVICES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    expect(limit).toBe(21);
    await fulfillJson(route, 200, rows.slice(offset, offset + limit));
  });
}

test.beforeEach(async ({ page }) => mockAuthenticatedWorkspace(page));

test("organizations and sites use bounded pages including empty and inactive rows", async ({ page }) => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ ...organizationPayload(), id: index === 21 ? ORGANIZATION_ID : `670b979d-9e60-5207-a5d2-${String(index).padStart(12, "0")}`, name: `Організація ${index}`, is_active: index !== 0 }));
  await page.route(`${ORGANIZATIONS_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset"));
    expect(url.searchParams.get("limit")).toBe("21");
    await fulfillJson(route, 200, rows.slice(offset, offset + 21));
  });
  await page.goto("/organizations");
  await expect(page.getByRole("link", { name: "Організація 0", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Організація 19", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Організація 20", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Наступна" }).click();
  await page.getByRole("link", { name: "Організація 21", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Об’єкти", exact: true })).toBeVisible();
  await page.route(`${SITES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    const sites = Array.from({ length: 21 }, (_, index) => ({ ...sitePayload(), id: index === 20 ? SITE_ID : `739512a9-6ddb-4f8e-99e9-${String(index).padStart(12, "0")}`, name: `Об’єкт ${index}` }));
    await fulfillJson(route, 200, sites.slice(offset, offset + 21));
  });
  await page.getByRole("button", { name: "Оновити список" }).click();
  await expect(page.getByRole("link", { name: "Об’єкт 19", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Наступна" }).click();
  await expect(page.getByRole("button", { name: "Наступна" })).toBeDisabled();
  await page.getByRole("link", { name: "Об’єкт 20", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${tenantPath}$`, "u"));
  await expect(page.getByRole("link", { name: "Насосна станція №1" })).toBeVisible();
});

test("confirmed context survives reload and /devices revalidates the saved site", async ({ page }) => {
  await page.goto(tenantPath);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => Object.entries(sessionStorage));
  expect(saved).toEqual([[`kerumo.context.v1:${USER_ID}:${SESSION_ID}`, JSON.stringify({ organizationId: ORGANIZATION_ID, siteId: SITE_ID })]]);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Шлях до об’єкта" })).toContainText("Тестовий об’єкт");
  let reads = 0;
  await page.route(`${API_ORIGIN}/api/v1/sites/${SITE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    reads += 1;
    await fulfillJson(route, 200, sitePayload());
  });
  await page.goto("/devices");
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
});

test("a saved removed site has a recovery path and never falls back to fixtures", async ({ page }) => {
  await page.goto(tenantPath);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await page.route(`${API_ORIGIN}/api/v1/sites/${SITE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 404, { detail: "Об’єкт видалено" });
  });
  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Немає доступної організації" })).toBeVisible();
  await expect(page.getByText("Насосна станція №1")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await page.getByRole("link", { name: "Обрати організацію" }).click();
  await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible();
});

test("a site from a different parent is rejected before requesting devices", async ({ page }) => {
  let listCalls = 0;
  page.on("request", (request) => { if (request.method() === "GET" && request.url().startsWith(DEVICES_URL)) listCalls += 1; });
  await page.route(`${API_ORIGIN}/api/v1/sites/${SITE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, { ...sitePayload(), organization_id: otherOrg });
  });
  await page.goto(tenantPath);
  await expect(page.getByRole("heading", { name: "Не вдалося перевірити права" })).toBeVisible();
  expect(listCalls).toBe(0);
  await expect(page.getByText("Насосна станція №1")).toHaveCount(0);
});

test("changing tenants hides previous rows and restores only the newly validated context", async ({ page }) => {
  await page.route(`${ORGANIZATIONS_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, [organizationPayload(), { ...organizationPayload(), id: otherOrg, name: "Інша організація" }]);
  });
  for (const [url, body] of [
    [`${ORGANIZATIONS_URL}/${otherOrg}`, { ...organizationPayload(), id: otherOrg, name: "Інша організація" }],
    [`${ORGANIZATIONS_URL}/${otherOrg}/access`, { ...accessPayload(), organization_id: otherOrg }],
    [`${ORGANIZATIONS_URL}/${otherOrg}/sites?*`, [{ ...sitePayload(), id: otherSite, organization_id: otherOrg, name: "Інший об’єкт" }]],
    [`${API_ORIGIN}/api/v1/sites/${otherSite}`, { ...sitePayload(), id: otherSite, organization_id: otherOrg, name: "Інший об’єкт" }],
    [`${API_ORIGIN}/api/v1/sites/${otherSite}/devices?*`, []],
  ] as const) await page.route(url, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, body);
  });
  await page.goto(tenantPath);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
  await page.getByRole("link", { name: "Інша організація", exact: true }).click();
  await page.getByRole("link", { name: "Інший об’єкт", exact: true }).click();
  await expect(page.getByText("На цій сторінці пристроїв немає.")).toBeVisible();
  await expect(page.getByText("Насосна станція №1")).toHaveCount(0);
  await page.goto("/devices");
  await expect(page.getByRole("navigation", { name: "Шлях до об’єкта" })).toContainText("Інший об’єкт");
  await expect(page.getByText("Насосна станція №1")).toHaveCount(0);
});

test("presence distinguishes offline, never connected and unavailable without fake telemetry", async ({ page }) => {
  const rows = Array.from({ length: 4 }, (_, index) => devicePayload(index));
  await devices(page, rows);
  for (const [index, device] of rows.entries()) await page.route(`${API_ORIGIN}/api/v1/devices/${device.id}/availability`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, index === 3 ? 503 : 200, index === 3 ? { detail: "Unavailable" } : { ...availabilityPayload(device), online: index === 0, ...(index === 2 ? { last_seen_at: null, seconds_since_seen: null } : {}) });
  });
  await page.goto(tenantPath);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByText("Ще не було зв’язку", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Стан невідомий", { exact: true })).toBeVisible();
  await expect(page.getByText(/Життєвий цикл: active/)).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Запустити" })).toHaveCount(0);
  await page.getByRole("link", { name: "Насосна станція №1" }).click();
  await expect(page.getByRole("heading", { name: "Насосна станція №1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Модулі та канали" })).toBeVisible();
  await expect(page.getByText("Насос працює")).toHaveCount(0);
});

test("paging cancels old presence workers and late responses cannot overwrite the new page", async ({ page }) => {
  const rows = Array.from({ length: 25 }, (_, index) => devicePayload(index));
  await devices(page, rows);
  const started: number[] = [];
  const release: (() => void)[] = [];
  await page.route(`${API_ORIGIN}/api/v1/devices/*/availability`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const index = rows.findIndex((device) => route.request().url().includes(device.id));
    started.push(index);
    if (index < 20) await new Promise<void>((resolve) => release.push(resolve));
    await fulfillJson(route, 200, availabilityPayload(rows[index]!)).catch(() => {});
  });
  try {
    await page.goto(tenantPath);
    await expect.poll(() => started.length).toBe(4);
    expect(started.every((index) => index < 20)).toBe(true);
    await page.getByRole("button", { name: "Наступна" }).click();
    await expect(page.getByText("Online", { exact: true })).toHaveCount(5);
    await expect(page.getByRole("link", { name: "Контролер 24", exact: true })).toBeVisible();
    release.forEach((resolve) => resolve());
    await expect(page.getByRole("link", { name: "Насосна станція №1" })).toHaveCount(0);
    expect(started.filter((index) => index < 20)).toHaveLength(4);
    expect(started.filter((index) => index >= 20)).toHaveLength(5);
  } finally { release.forEach((resolve) => resolve()); }
});

for (const status of [403, 503]) test(`device list ${status} is visible as an error with no fixture fallback`, async ({ page }) => {
  let calls = 0;
  await page.route(`${DEVICES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    calls += 1;
    await fulfillJson(route, status, { detail: "Unavailable" });
  });
  await page.goto(tenantPath);
  await expect(page.getByRole("heading", { name: status === 403 ? "Дані більше недоступні" : "Не вдалося завантажити дані" })).toBeVisible({ timeout: 15_000 });
  expect(calls).toBe(status === 403 ? 1 : 3);
  await expect(page.getByText("Насосна станція №1")).toHaveCount(0);
});

test("unknown fixture slug and denied UUID never render a demonstration dashboard", async ({ page }) => {
  await page.goto("/devices/north-pump");
  await expect(page.getByText(/Некоректне посилання/)).toBeVisible();
  await expect(page.getByText("Насос працює")).toHaveCount(0);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 403, { detail: "Forbidden" });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("heading", { name: "Немає доступної організації" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Насосна станція №1" })).toHaveCount(0);
});


test("organization/site deep link resumes after login and logout clears its saved context", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await mockBrowserLoginSuccess(page);
  await mockBrowserLogoutSuccess(page);
  await page.goto(tenantPath);
  await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(tenantPath)}$`, "u"));
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toHaveLength(1);
  await page.locator(".sidebar").getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("revoked presence hides rows and a successful explicit retry restores them", async ({ page }) => {
  let available = false;
  let calls = 0;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/availability`, async (route) => {
    if (await fulfillPreflight(route)) return;
    calls += 1;
    await fulfillJson(route, available ? 200 : 403, available ? availabilityPayload() : { detail: "Forbidden" });
  });
  await page.goto(tenantPath);
  await expect(page.getByRole("heading", { name: "Дані більше недоступні" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Насосна станція №1" })).toHaveCount(0);
  expect(calls).toBe(1);
  available = true;
  await page.getByRole("button", { name: "Повторити", exact: true }).click();
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Насосна станція №1" })).toBeVisible();
  expect(calls).toBe(2);
});


test("mobile inventory preserves breadcrumbs, last-seen time and real device navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(tenantPath);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Шлях до об’єкта" })).toContainText("Тестовий об’єкт");
  await expect(page.getByText(/Останній зв’язок:/u)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Мобільна навігація" })).toBeVisible();
  await page.getByRole("link", { name: "Насосна станція №1" }).click();
  await expect(page.getByRole("heading", { name: "Насосна станція №1" })).toBeVisible();
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
