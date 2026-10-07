import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { programOverview } from "../fixtures/commands";
import { seriesFixture } from "../fixtures/series";
import { refreshButton } from "../helpers/customer-details";
import {
  API_ORIGIN,
  DEVICE_ID,
  ORGANIZATION_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";

function equipmentReadings() {
  const data = programOverview();
  const keys = ["vfd.current_a", "vfd.frequency_hz", "vfd.set_frequency_hz", "vfd.voltage_v"];
  data.modules[0]!.channels = keys.map((key) => ({
    key,
    source: "values",
    data_type: "number",
    unit: key.endsWith("_hz") ? "Hz" : key.endsWith("_a") ? "A" : "V",
    supports_series: true,
  }));
  data.value_keys = keys;
  data.readings = data.modules[0]!.channels.map((channel) => ({
    key: channel.key,
    unit: channel.unit!,
    value: channel.key === "vfd.set_frequency_hz" ? 40 : 0,
    status: "fresh",
  }));
  return data;
}

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, equipmentReadings());
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const params = new URL(route.request().url()).searchParams;
    const metric = params.get("metric")!;
    const data = seriesFixture(
      { start: params.get("start")!, end: params.get("end")!, bucket_seconds: Number(params.get("bucket_seconds")) },
      metric,
      DEVICE_ID,
      true,
    );
    await fulfillJson(route, 200, { ...data, unit: metric.endsWith("_hz") ? "Hz" : metric.endsWith("_a") ? "A" : "V" });
  });
});

for (const width of [320, 393, 768, 1280]) {
  test(`readings follow the same order and keep refresh secondary at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto(`/devices/${DEVICE_ID}`);
    await expect(page.locator(".overview-readings .metric-label")).toHaveText([
      "Задана частота",
      "Вихідна частота",
      "Струм",
      "Вихідна напруга",
      "Код помилки частотника",
      "Стан роботи частотника",
    ]);
    const cards = page.locator(".overview-readings .metric-card");
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    if (width > 520) {
      for (const i of [0, 2, 4]) {
        expect(Math.abs(boxes[i]!.y - boxes[i + 1]!.y)).toBeLessThan(2);
        expect(boxes[i]!.x).toBeLessThan(boxes[i + 1]!.x);
      }
    } else {
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
    }
    await expect(page.getByRole("button", { name: "Оновити панель" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeVisible();
    await expect(await refreshButton(page, "Оновити панель")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 393 || width === 1280)
      await test
        .info()
        .attach(`readings-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
  test(`organization members belong to the objects header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto(`/organizations/${ORGANIZATION_ID}/sites`);
    const header = page.locator(".page-header");
    await expect(header.getByRole("heading", { name: "Об’єкти", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Учасники організації" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Оновити список" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Оновити список" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("graph periods are ordered, bounded and retain exact UTC requests", async ({ page }) => {
  await page.goto(`/devices/${DEVICE_ID}?view=charts`);
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  const period = page.getByLabel("Період", { exact: true });
  const values = await period
    .locator("option")
    .evaluateAll((options) => options.map((option) => Number((option as HTMLOptionElement).value)));
  expect(values).toEqual([900, 1800, 3600, 10800, 21600, 43200, 86400, 172800, 259200, 604800]);
  await expect(period).toHaveValue("3600");
  for (const seconds of [900, 43200, 259200]) {
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("/telemetry/series?") &&
        Date.parse(new URL(r.url()).searchParams.get("end")!) -
          Date.parse(new URL(r.url()).searchParams.get("start")!) ===
          seconds * 1000,
    );
    await period.selectOption(String(seconds));
    const params = new URL((await response).url()).searchParams;
    expect(Math.ceil(seconds / Number(params.get("bucket_seconds")))).toBeLessThanOrEqual(1000);
  }
});

test("graph inspection distinguishes zero, partial data and gaps using the keyboard", async ({ page }) => {
  await page.goto(`/devices/${DEVICE_ID}?view=charts`);
  await page.getByLabel("Показник", { exact: true }).selectOption("vfd.frequency_hz");
  const slider = page.getByRole("slider", { name: "Час на графіку" });
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press("Home");
  await expect(page.locator(".chart-selection-values")).toContainText("0 Hz");
  await expect(page.locator(".chart-selection-time")).toContainText("Повні дані");
  await slider.press("ArrowRight");
  await expect(page.locator(".chart-selection-values")).toContainText("Немає даних");
  await expect(page.locator(".chart-selection-time")).toContainText("Немає повідомлень");
  await slider.press("ArrowRight");
  await expect(page.locator(".chart-selection-time")).toContainText("Часткові дані");
  await expect(page.locator(".telemetry-chart path")).toHaveCount(2);
  await expect(page.locator(".telemetry-chart text").filter({ hasText: /Початок|Кінець/ })).toHaveCount(0);
  const audit = await new AxeBuilder({ page })
    .include(".telemetry-chart-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
});

test.describe("touch chart", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 320, height: 852 } });
  test("tapping the graph reads a missing interval without inventing a zero", async ({ page }) => {
    await page.goto(`/devices/${DEVICE_ID}?view=charts`);
    const chart = page.locator(".telemetry-chart");
    await expect(chart).toBeVisible();
    await chart.scrollIntoViewIfNeeded();
    const box = (await chart.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect(page.locator(".chart-selection-values")).toContainText("Немає даних");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Період", { exact: true }).selectOption("259200");
    await expect(chart.locator(".chart-time-label tspan")).toHaveCount(6);
    const labels = await Promise.all(
      (await chart.locator(".chart-time-label").all()).map((label) => label.boundingBox()),
    );
    for (let i = 1; i < labels.length; i++) expect(labels[i - 1]!.x + labels[i - 1]!.width).toBeLessThan(labels[i]!.x);
    await test
      .info()
      .attach("touch-chart", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
});

for (const width of [320, 1280])
  test(`schedule descriptions are separated from creation actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto(`/devices/${DEVICE_ID}?view=schedules`);
    await expect(page.getByRole("heading", { name: "Збережені розклади" })).toBeVisible();
    const count = page.getByText("0 із 8 розкладів. Призупинені також враховуються.", { exact: true });
    await expect(count).toBeVisible();
    const text = (await count.boundingBox())!;
    const button = (await page.getByRole("button", { name: "Новий розклад", exact: true }).boundingBox())!;
    expect(button.y - text.y - text.height).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole("button", { name: "Оновити розклади" })).toBeHidden();
  });
