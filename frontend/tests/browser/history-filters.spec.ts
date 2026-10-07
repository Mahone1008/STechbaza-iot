import { displaySettings, historyInterval } from "../helpers/customer-details";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { overviewWithFrequencyFixture } from "../fixtures/overview";
import { seriesFixture } from "../fixtures/series";
import { API_ORIGIN, DEVICE_ID, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
test.use({ isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, overviewWithFrequencyFixture(devicePayload()));
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const params = new URL(route.request().url()).searchParams;
    const metric = params.get("metric")!;
    const data = seriesFixture({ start: params.get("start")!, end: params.get("end")!, bucket_seconds: Number(params.get("bucket_seconds")) }, metric, DEVICE_ID, true);
    await fulfillJson(route, 200, { ...data, unit: metric === "vfd.frequency_hz" ? "Hz" : "bar" });
  });
});

for (const width of [320, 393]) test(`history filters and their open pickers fit a ${width}px mobile viewport`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await page.goto(`/devices/${DEVICE_ID}`); await page.getByRole("tab", { name: "Графіки", exact: true }).click();
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  await (await displaySettings(page)).selectOption("0");

  for (const label of ["Показник", "Період", "Інтервал"]) {
    if (label === "Інтервал") await historyInterval(page);
    const select = page.getByLabel(label, { exact: true });
    await select.click();
    const options = select.getByRole("option");
    await expect(options.first()).toBeVisible();
    for (const option of await options.all()) {
      await option.scrollIntoViewIfNeeded();
      const box = await option.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(852);
      expect(box!.height).toBeLessThanOrEqual(64);
    }
    await test.info().attach(`picker-${label}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(select).toBeFocused();
  }

  const metric = page.getByLabel("Показник", { exact: true });
  await metric.click();
  await metric.getByRole("option", { name: "Вихідна частота · Hz", exact: true }).click();
  await expect(metric).toHaveValue("vfd.frequency_hz");
  await expect(page.getByRole("img", { name: /Історія Вихідна частота, Hz/u })).toBeVisible();

  const period = page.getByLabel("Період", { exact: true });
  await period.click();
  await period.getByRole("option", { name: "24 години", exact: true }).click();
  await expect(period).toHaveValue("86400");
  const interval = (await historyInterval(page));
  await interval.click();
  await expect(interval.getByRole("option", { name: "1 хв", exact: true })).toHaveJSProperty("disabled", true);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(interval).toHaveValue("86400");
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include(".telemetry-history-controls").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
});
