import { expect, test, type Page } from "@playwright/test";
import { overviewFixture, overviewWithFrequencyFixture } from "../fixtures/overview";
import { seriesFixture } from "../fixtures/series";
import { API_ORIGIN, DEVICE_ID, ME_URL, currentUserPayload, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, mockBrowserLogoutSuccess } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const path = `/devices/${DEVICE_ID}`;
const overviewUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`;
async function ready(page: Page) {
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  await expect(page.getByRole("button", { name: "Оновити історію" })).toBeEnabled();
}
async function choose(page: Page) {
  await page.getByLabel("Метрика", { exact: true }).selectOption("vfd.frequency_hz");
  await page.getByLabel("Період", { exact: true }).selectOption("21600");
  await page.getByLabel("Інтервал", { exact: true }).selectOption("900");
  await ready(page);
}
async function selection(page: Page, metric: string, seconds: string, bucket: string) {
  await expect(page.getByLabel("Метрика", { exact: true })).toHaveValue(metric);
  await expect(page.getByLabel("Період", { exact: true })).toHaveValue(seconds);
  await expect(page.getByLabel("Інтервал", { exact: true })).toHaveValue(bucket);
}
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, overviewWithFrequencyFixture(devicePayload())); });
  await page.route(`${API_ORIGIN}/api/v1/devices/*/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const url = new URL(route.request().url()), p = url.searchParams, metric = p.get("metric")!;
    await fulfillJson(route, 200, { ...seriesFixture({ start: p.get("start")!, end: p.get("end")!, bucket_seconds: Number(p.get("bucket_seconds")) }, metric, url.pathname.split("/")[4], true), unit: metric === "vfd.frequency_hz" ? "Hz" : "bar" });
  });
});

test("F5 restores metric, six-hour period and fifteen-minute interval before the first series request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET" && r.url().includes("/telemetry/series?")) requests.push(r.url()); });
  await page.goto(path); await ready(page); await choose(page);
  requests.length = 0;
  await page.reload(); await ready(page);
  await selection(page, "vfd.frequency_hz", "21600", "900");
  await expect(page.getByRole("img", { name: /Історія vfd.frequency_hz, Hz/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  const params = new URL(requests[0]!).searchParams;
  expect(params.get("metric")).toBe("vfd.frequency_hz");
  expect(params.get("bucket_seconds")).toBe("900");
  expect(Date.parse(params.get("end")!) - Date.parse(params.get("start")!)).toBe(21600000);
});

test("reload validates stored metric against enabled channels and recovers from corrupt storage", async ({ page }) => {
  await page.goto(path); await ready(page); await choose(page);
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, overviewFixture(devicePayload())); });
  const metrics: string[] = [];
  page.on("request", (r) => { if (r.method() === "GET" && r.url().includes("/telemetry/series?")) metrics.push(new URL(r.url()).searchParams.get("metric")!); });
  await page.reload(); await ready(page);
  await selection(page, "pressure.bar", "21600", "900");
  expect(metrics).toEqual(["pressure.bar"]);
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) => key.includes(":history:"))!;
    sessionStorage.setItem(key, "{broken");
  });
  await page.reload(); await ready(page);
  await selection(page, "pressure.bar", "3600", "60");
});

test("device and session selections stay isolated and logout clears saved history preferences", async ({ page }) => {
  const other = devicePayload(2);
  await page.route(`${API_ORIGIN}/api/v1/devices/${other.id}`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, other); });
  await page.route(`${API_ORIGIN}/api/v1/devices/${other.id}/overview`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, overviewWithFrequencyFixture(other)); });
  await mockBrowserLogoutSuccess(page);
  await page.goto(path); await ready(page); await choose(page);
  await page.goto(`/devices/${other.id}`); await ready(page);
  await selection(page, "pressure.bar", "3600", "60");
  await page.getByLabel("Період", { exact: true }).selectOption("86400"); await ready(page);
  await page.goto(path); await ready(page);
  await selection(page, "vfd.frequency_hz", "21600", "900");
  await page.route(ME_URL, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, { ...currentUserPayload(), auth_session_id: "4df58667-7a29-47f8-b6d6-055e47717681" }); });
  await page.reload(); await ready(page);
  await selection(page, "pressure.bar", "3600", "60");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes(":history:")).length)).toBe(2);
  await page.locator(".sidebar").getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("kerumo.context.v1:")))).toEqual([]);
});

test("blocked sessionStorage permits filter changes and safely uses defaults after reload", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.goto(path); await ready(page); await choose(page);
  await selection(page, "vfd.frequency_hz", "21600", "900");
  await page.reload(); await ready(page);
  await selection(page, "pressure.bar", "3600", "60");
});
