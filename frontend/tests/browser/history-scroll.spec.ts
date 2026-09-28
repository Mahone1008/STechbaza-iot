import { expect, test, type Page } from "@playwright/test";
import { overviewFixture } from "../fixtures/overview";
import { seriesFixture } from "../fixtures/series";
import { API_ORIGIN, DEVICE_ID, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const seriesUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/telemetry/series?*`;
const overviewUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function overview() {
  const data = overviewFixture(devicePayload());
  const capability = { ...data.capabilities[0]!, id: "c41c4b87-b82d-4e35-8faa-000000000004", code: "vfd.frequency.read", name: "Частота" };
  data.capabilities.push(capability);
  data.modules.push({ assignment_id: "a41c4b87-b82d-4e35-8faa-000000000004", capability_id: capability.id, code: capability.code, supported: true, channels: [{ key: "vfd.frequency_hz", unit: "Hz", source: "values", data_type: "number", supports_series: true }], command_types: [], allowed_commands: [] });
  data.readings.push({ key: "vfd.frequency_hz", unit: "Hz", value: 0, status: "fresh" });
  data.value_keys.push("vfd.frequency_hz");
  return data;
}
function series(url: string, populated = true) {
  const params = new URL(url).searchParams;
  const metric = params.get("metric")!;
  return { ...seriesFixture({ start: params.get("start")!, end: params.get("end")!, bucket_seconds: Number(params.get("bucket_seconds")) }, metric, DEVICE_ID, populated), unit: metric === "vfd.frequency_hz" ? "Hz" : "bar" };
}
async function ready(page: Page, manual = true) {
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  if (manual) await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
}
async function position(page: Page) {
  await page.getByLabel("Метрика", { exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(100);
  return y;
}
async function stable(page: Page, y: number, clock = false) {
  // Дві намальовані frame дають браузеру застосувати layout/scroll anchoring.
  if (clock) await page.clock.runFor(32);
  else await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(Math.abs(await page.evaluate(() => scrollY) - y)).toBeLessThanOrEqual(2);
}
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, overview()); });
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, series(route.request().url())); });
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`metric, period and interval retain scroll during and after loading at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await ready(page);
    for (const [label, value] of [["Метрика", "vfd.frequency_hz"], ["Період", "86400"], ["Інтервал", "3600"]]) {
      const response = gate();
      await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await response.promise; await fulfillJson(route, 200, series(route.request().url())).catch(() => {}); });
      try {
        const y = await position(page);
        await page.getByLabel(label!, { exact: true }).selectOption(value!);
        await expect(page.getByText("Завантажуємо історію…")).toBeVisible();
        await expect(page.locator(".telemetry-chart")).toHaveCount(0);
        await stable(page, y);
        response.release();
        await expect(page.getByRole("img", { name: /Історія vfd.frequency_hz, Hz/ })).toBeVisible();
        await stable(page, y);
      } finally { response.release(); }
    }
  });
}

test("empty and failed history retain space after an expanded table without showing old data", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await ready(page);
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  const y = await position(page);
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, series(route.request().url(), false)); });
  await page.getByRole("button", { name: "Оновити історію" }).click();
  await expect(page.getByText("За цей період немає валідних вимірювань.")).toBeVisible();
  await expect(page.locator(".telemetry-chart")).toHaveCount(0);
  await stable(page, y);
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 503, { detail: "Unavailable" }); });
  await page.getByRole("button", { name: "Оновити історію" }).click();
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await stable(page, y);
});

test("automatic overview and history refresh preserve scroll while old values are hidden", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1280, height: 720 }); await ready(page, false);
  const panel = gate(), history = gate();
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await panel.promise; await fulfillJson(route, 200, overview()).catch(() => {}); });
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await history.promise; await fulfillJson(route, 200, series(route.request().url())).catch(() => {}); });
  try {
    const y = await position(page);
    await page.clock.runFor(31000);
    await expect(page.getByText("Перевіряємо модулі та показання…")).toBeVisible();
    await expect(page.locator(".telemetry-chart")).toBeHidden();
    await expect(page.getByLabel("Метрика", { exact: true })).toBeHidden();
    await stable(page, y, true);
    panel.release();
    await expect(page.locator(".telemetry-chart")).toBeVisible();
    await stable(page, y, true);
    await page.clock.runFor(31000);
    await expect(page.getByText("Завантажуємо історію…")).toBeVisible();
    await expect(page.locator(".telemetry-chart")).toHaveCount(0);
    await stable(page, y, true);
    history.release();
    await expect(page.locator(".telemetry-chart")).toBeVisible();
    await stable(page, y, true);
  } finally { panel.release(); history.release(); }
});
