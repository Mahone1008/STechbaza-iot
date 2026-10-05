import { expect, test, type Page } from "@playwright/test";
import { seriesFixture } from "../fixtures/series";
import { overviewFixture } from "../fixtures/overview";
import { API_ORIGIN, DEVICE_ID, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, corsHeaders } from "./auth-fixtures";
test.describe.configure({ retries: 0 });
const path = `/devices/${DEVICE_ID}`;
const seriesUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/telemetry/series?*`;
async function populated(page: Page) {
  await page.route(seriesUrl, async (route) => {
    if (await fulfillPreflight(route)) return;
    const url = new URL(route.request().url());
    await fulfillJson(route, 200, seriesFixture({ start: url.searchParams.get("start")!, end: url.searchParams.get("end")!, bucket_seconds: Number(url.searchParams.get("bucket_seconds")) }, "pressure.bar", DEVICE_ID, true));
  });
}
async function ready(page: Page) {
  await page.goto(path); await page.getByRole("tab", { name: "Графіки", exact: true }).click(); await expect(page.getByRole("button", { name: "Оновити історію" })).toBeEnabled();
  await expect(page.getByText("Завантажуємо історію…")).toHaveCount(0);
}
test.beforeEach(async ({ page }) => { await mockAuthenticatedWorkspace(page); });
test("history shows units, disconnected gaps, counts and site timezone on a narrow screen", async ({ page }) => {
  await populated(page); await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  await expect(page.getByRole("img", { name: /Історія pressure.bar/ })).toBeVisible();
  await expect(page.locator(".telemetry-chart path")).toHaveCount(2);
  await expect(page.getByText(/Валідних вимірювань: 2; повідомлень: 3/)).toBeVisible();
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Europe/Kyiv");
  await expect(page.getByRole("table")).toContainText("Часткові дані");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("period and bucket controls produce bounded UTC requests and empty history", async ({ page }) => {
  await ready(page);
  await expect(page.getByText("За цей період немає валідних вимірювань.")).toBeVisible();
  const response = page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes("/telemetry/series?") && r.url().includes("bucket_seconds=3600"));
  await page.getByLabel("Період", { exact: true }).selectOption("604800");
  const url = new URL((await response).url());
  expect(url.searchParams.get("metric")).toBe("pressure.bar"); expect(url.searchParams.get("start")).toMatch(/Z$/);
  expect(Date.parse(url.searchParams.get("end")!) - Date.parse(url.searchParams.get("start")!)).toBe(604800000);
  // Перевіряємо native option: toBeDisabled retargets вкладений label до select.
  await expect(page.getByLabel("Інтервал", { exact: true }).locator('option[value="60"]')).toHaveJSProperty("disabled", true);
  await expect(page.getByLabel("Метрика", { exact: true }).locator("option")).toHaveCount(1);
});
for (const status of [403, 409, 422, 503]) test(`history ${status} removes previous chart and permits explicit recovery`, async ({ page }) => {
  await populated(page); await ready(page); await expect(page.locator(".telemetry-chart")).toBeVisible();
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, status, { detail: "Unavailable" }); });
  await page.getByRole("button", { name: "Оновити історію" }).click();
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible(); await expect(page.locator(".telemetry-chart")).toHaveCount(0);
  await populated(page); await page.getByRole("button", { name: "Оновити історію" }).click();
  await expect(page.locator(".telemetry-chart")).toBeVisible();
});
test("foreign history is rejected and disabled module removes history controls", async ({ page }) => {
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, { device_id: "foreign" }); });
  await ready(page); await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible();
  const data = overviewFixture(devicePayload()); data.modules = []; data.command_types = []; data.allowed_commands = []; data.capabilities = []; data.readings = []; data.state_readings = [];
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, data); });
  await page.getByRole("button", { name: "Оновити панель" }).click();
  await expect(page.getByText("Увімкнених каналів з підтримкою історії немає.")).toBeVisible(); await expect(page.getByLabel("Метрика", { exact: true })).toHaveCount(0);
});
test("charts poll history without polling the inactive panel, and manual mode pauses both", async ({ page }) => {
  await page.clock.install(); let overview = 0, series = 0;
  page.on("request", (r) => { if (r.method() !== "GET") return; if (r.url().endsWith("/overview")) overview++; if (r.url().includes("/telemetry/series?")) series++; });
  await ready(page);
  await expect(page.getByLabel("Автооновлення", { exact: true })).toHaveValue("5");
  expect(overview).toBe(1); expect(series).toBe(1);
  await page.clock.runFor(6000); expect(overview).toBe(1); expect(series).toBe(1);
  await page.clock.runFor(55000); await expect.poll(() => series).toBe(2); expect(overview).toBe(1);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
  await page.clock.runFor(61000); expect(overview).toBe(1); expect(series).toBe(2);
});
test("polling follows selected 30/60 budget, pauses hidden and manual modes, resumes without catch-up bursts", async ({ page }) => {
  await page.clock.install(); let overview = 0, series = 0;
  page.on("request", (r) => { if (r.method() !== "GET") return; if (r.url().endsWith("/overview")) overview++; if (r.url().includes("/telemetry/series?")) series++; });
  await ready(page); expect(overview).toBe(1); expect(series).toBe(1);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("30");
  await page.clock.runFor(31000); await expect.poll(() => overview).toBe(1); expect(series).toBe(1);
  await page.clock.runFor(31000); await expect.poll(() => series).toBe(2); await expect.poll(() => overview).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(180000); expect(overview).toBe(1); expect(series).toBe(2);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => overview).toBe(1); await expect.poll(() => series).toBe(3);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
  await page.clock.runFor(120000); expect(overview).toBe(1); expect(series).toBe(3);
});
test("Retry-After blocks manual retries and hidden resume; automatic retry recovers", async ({ page }) => {
  await page.clock.install(); await ready(page); let calls = 0;
  await page.route(seriesUrl, async (route) => {
    if (await fulfillPreflight(route)) return; calls++;
    if (calls === 1) { await route.fulfill({ status: 429, headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "120" }, body: JSON.stringify({ detail: "Wait" }) }); return; }
    const u = new URL(route.request().url()); await fulfillJson(route, 200, seriesFixture({ start: u.searchParams.get("start")!, end: u.searchParams.get("end")!, bucket_seconds: Number(u.searchParams.get("bucket_seconds")) }));
  });
  await page.getByRole("button", { name: "Оновити історію" }).click(); await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible();
  await page.getByRole("button", { name: "Оновити історію" }).click(); expect(calls).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(61000); expect(calls).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible(); expect(calls).toBe(1);
  await page.clock.runFor(61000); await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toHaveCount(0);
});
test("late history after navigation is cancelled and never renders on directory", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let started = false;
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; started = true; await gate; await fulfillJson(route, 200, {}).catch(() => {}); });
  try {
    await page.goto(path); await page.getByRole("tab", { name: "Графіки", exact: true }).click(); await expect.poll(() => started).toBe(true);
    await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible(); release();
    await expect(page.getByRole("heading", { name: "Історія телеметрії" })).toHaveCount(0);
  } finally { release(); }
});

test("offline cancels refresh traffic; manual-only mode does not refresh on returning online", async ({ page }) => {
  await page.clock.install(); let requests = 0;
  page.on("request", (r) => { if (r.method() === "GET" && (r.url().endsWith("/overview") || r.url().includes("/telemetry/series?"))) requests++; });
  await ready(page); expect(requests).toBe(2);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  await expect(page.getByRole("button", { name: "Оновити панель" })).toBeDisabled();
  await page.clock.runFor(120000); expect(requests).toBe(2);
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); });
  await expect(page.getByRole("button", { name: "Оновити панель" })).toBeEnabled();
  await page.clock.runFor(61000); expect(requests).toBe(2);
  await page.getByRole("button", { name: "Оновити панель" }).click();
  await expect.poll(() => requests).toBe(3);
});
