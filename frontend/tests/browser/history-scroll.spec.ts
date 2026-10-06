import { displaySettings, historyInterval } from "../helpers/customer-details";
import { expect, test, type Page } from "@playwright/test";
import { diagnosticsFixture, overviewWithFrequencyFixture } from "../fixtures/overview";
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

function series(url: string, populated = true) {
  const params = new URL(url).searchParams;
  const metric = params.get("metric")!;
  return { ...seriesFixture({ start: params.get("start")!, end: params.get("end")!, bucket_seconds: Number(params.get("bucket_seconds")) }, metric, DEVICE_ID, populated), unit: metric === "vfd.frequency_hz" ? "Hz" : "bar" };
}
async function ready(page: Page, manual = true) {
  await page.goto(`/devices/${DEVICE_ID}`); await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  if (manual) await (await displaySettings(page)).selectOption("0");
}
async function position(page: Page) {
  await page.getByLabel("Показник", { exact: true }).evaluate((el) => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 80));
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
async function refreshVisibleHistory(page: Page) {
  const button = page.getByRole("button", { name: "Оновити історію" });
  await expect(button).toBeEnabled();
  await expect(button).toBeInViewport({ ratio: 1 });
  const box = (await button.boundingBox())!;
  // Натискання користувача без locator.click(), який сам викликає scrollIntoView.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, overviewWithFrequencyFixture(devicePayload())); });
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, series(route.request().url())); });
});

async function gapBeforeHistory(page: Page) {
  const controls = await page.locator(".device-tabs").boundingBox();
  const history = await page.locator("#device-section-charts section.card").filter({ has: page.getByRole("heading", { name: "Історія показань", exact: true }) }).boundingBox();
  return history!.y - (controls!.y + controls!.height);
}

test("resizing between mobile and desktop does not leave empty space before history", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 }); await ready(page);
  for (const width of [1280, 393, 820, 1280]) {
    await page.setViewportSize({ width, height: 852 });
    await expect.poll(() => gapBeforeHistory(page)).toBeLessThanOrEqual(24);
  }
});

for (const width of [1280, 393]) test(`settled diagnostics release unused panel space at ${width}px`, async ({ page }) => {
  const data = overviewWithFrequencyFixture(devicePayload());
  data.diagnostics = diagnosticsFixture();
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, data); });
  await page.setViewportSize({ width, height: 852 }); await ready(page);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await page.getByText("Технічні дані контролера", { exact: true }).click();
  await expect(page.getByText("Зупинку ще не підтверджено", { exact: true })).toBeVisible();
  data.diagnostics.last_stop = null;
  data.diagnostics.uptime_ms = 3000;
  await page.getByRole("button", { name: "Оновити панель" }).click();
  await expect(page.getByText("Не зафіксовано", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect.poll(() => gapBeforeHistory(page)).toBeLessThanOrEqual(24);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`metric, period and interval retain scroll during and after loading at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await ready(page);
    for (const [label, value] of [["Показник", "vfd.frequency_hz"], ["Період", "86400"], ["Інтервал", "3600"]]) {
      if (label === "Інтервал") await historyInterval(page);
      const response = gate();
      await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await response.promise; await fulfillJson(route, 200, series(route.request().url())).catch(() => {}); });
      try {
        const y = await position(page);
        await page.getByLabel(label!, { exact: true }).selectOption(value!);
        await expect(page.getByText("Завантажуємо історію…")).toBeVisible();
        await expect(page.locator(".telemetry-chart")).toHaveCount(0);
        await stable(page, y);
        response.release();
        await expect(page.getByRole("img", { name: /Історія Вихідна частота, Hz/ })).toBeVisible();
        await stable(page, y);
      } finally { response.release(); }
    }
  });
}

async function reservedHistorySpace(page: Page) {
  return page.locator(".history-result-region").evaluate((element) => element.getBoundingClientRect().height - element.firstElementChild!.getBoundingClientRect().height);
}

test("settled empty and failed history release unused space and hide failed data", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await ready(page);
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await position(page);
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, series(route.request().url(), false)); });
  await refreshVisibleHistory(page);
  await expect(page.getByText("За цей період немає вимірювань для графіка.")).toBeVisible();
  await expect(page.locator(".telemetry-chart")).toHaveCount(0);
  await expect.poll(() => reservedHistorySpace(page)).toBeLessThanOrEqual(2);
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 503, { detail: "Unavailable" }); });
  await refreshVisibleHistory(page);
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect.poll(() => reservedHistorySpace(page)).toBeLessThanOrEqual(2);
});

test("automatic refresh preserves scroll, keeps the chart and does not close the open table", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1280, height: 720 }); await ready(page, false);
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  // Цей сценарій координує 30/60 с, незалежно від типового інтервалу панелі.
  await (await displaySettings(page)).selectOption("30");
  const panel = gate(), history = gate();
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await panel.promise; await fulfillJson(route, 200, overviewWithFrequencyFixture(devicePayload())).catch(() => {}); });
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await history.promise; await fulfillJson(route, 200, series(route.request().url())).catch(() => {}); });
  try {
    const y = await position(page);
    await page.clock.runFor(61000);
    // Only the visible history polls; inactive overview must not occupy space.
    await expect(page.getByRole("button", { name: "Оновити панель" })).toBeEnabled();
    await expect(page.getByText("Оновлюємо історію…")).toBeVisible();
    await expect(page.locator(".telemetry-chart")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await stable(page, y, true);
    history.release();
    await expect(page.getByRole("button", { name: "Оновити історію" })).toBeEnabled();
    await expect(page.locator(".telemetry-chart")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await stable(page, y, true);
  } finally { panel.release(); history.release(); }
});

test("collapsing the measurements table releases its space but keeps the collapsed reserve during loading", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await ready(page);
  const card = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Історія показань", exact: true }) });
  const height = () => card.evaluate((element) => element.getBoundingClientRect().height);
  const collapsedHeight = await height();
  const summary = card.getByText("Таблиця вимірювань", { exact: true });
  await summary.click(); await expect(card.getByRole("table")).toBeVisible();
  await expect.poll(height).toBeGreaterThan(collapsedHeight + 100);
  await summary.click(); await expect(card.getByRole("table")).toBeHidden();
  await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
  const response = gate();
  await page.route(seriesUrl, async (route) => { if (await fulfillPreflight(route)) return; await response.promise; await fulfillJson(route, 200, series(route.request().url())).catch(() => {}); });
  try {
    const y = await position(page);
    await refreshVisibleHistory(page);
    await expect(page.getByText("Оновлюємо історію…")).toBeVisible();
    await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
    await stable(page, y);
    response.release();
    await expect(page.locator(".telemetry-chart")).toBeVisible();
    await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
    await stable(page, y);
  } finally { response.release(); }
});

for (const width of [320, 1280]) test(`changing all three history filters releases an expanded table reserve at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 }); await ready(page);
  for (const [label, value] of [["Показник", "vfd.frequency_hz"], ["Період", "21600"], ["Інтервал", "900"]]) {
    if (label === "Інтервал") await historyInterval(page);
    await page.getByText("Таблиця вимірювань", { exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    const response = gate();
    await page.route(seriesUrl, async (route) => {
      if (await fulfillPreflight(route)) return;
      await response.promise;
      await fulfillJson(route, 200, series(route.request().url(), false)).catch(() => {});
    });
    try {
      await page.getByLabel(label!, { exact: true }).selectOption(value!);
      await expect(page.getByText("Завантажуємо історію…")).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.locator(".telemetry-chart")).toHaveCount(0);
      response.release();
      await expect(page.getByText("За цей період немає вимірювань для графіка.", { exact: true })).toBeVisible();
      await expect(page.getByRole("table")).toBeHidden();
      await expect.poll(() => reservedHistorySpace(page)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { response.release(); }
  }
  await page.getByLabel("Показник", { exact: true }).scrollIntoViewIfNeeded();
  await test.info().attach(`history-empty-${width}`, { body: await page.screenshot(), contentType: "image/png" });
});

test("current with missing measurements has an explanation and no retained chart area", async ({ page }) => {
  const data = overviewWithFrequencyFixture(devicePayload());
  const capability = { ...data.capabilities[0]!, id: "c41c4b87-b82d-4e35-8faa-000000000005", code: "vfd.current.read", name: "Струм" };
  data.capabilities.push(capability);
  data.modules.push({ assignment_id: "a41c4b87-b82d-4e35-8faa-000000000005", capability_id: capability.id, code: capability.code, supported: true, channels: [{ key: "vfd.current_a", unit: "A", source: "values", data_type: "number", supports_series: true }], command_types: [], allowed_commands: [] });
  data.value_keys.push("vfd.current_a");
  data.readings.push({ key: "vfd.current_a", unit: "A", value: null, status: "missing" });
  await page.route(overviewUrl, async (route) => { if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data); });
  await ready(page);
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  await page.route(seriesUrl, async (route) => {
    if (await fulfillPreflight(route)) return;
    const result = series(route.request().url(), false);
    result.unit = "A";
    result.message_count = 648;
    result.buckets[0] = { ...result.buckets[0]!, status: "missing", missing_count: 648 };
    await fulfillJson(route, 200, result);
  });
  await page.getByLabel("Показник", { exact: true }).selectOption("vfd.current_a");
  for (const period of ["3600", "21600"]) {
    await page.getByLabel("Період", { exact: true }).selectOption(period);
    await expect(page.getByText(/Для цього показника надходили неповні або некоректні дані/)).toBeVisible();
    await expect(page.getByText(/Вимірювань для графіка: 0; повідомлень: 648/)).toBeVisible();
    await expect(page.locator(".telemetry-chart")).toHaveCount(0);
    await expect(page.getByRole("table")).toBeHidden();
    await expect.poll(() => reservedHistorySpace(page)).toBeLessThanOrEqual(2);
  }
});
