import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { scheduleOverview } from "../fixtures/schedules";
import { API_ORIGIN, DEVICE_ID, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";
import type { ScheduleWrite } from "../../src/lib/api/schedules";

const base = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
const trigger = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^Відкрити календар: ${label}`) });
async function editor(page: Page) {
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("tab", { name: "Розклади", exact: true }).click();
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, scheduleOverview());
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
});

for (const [width, height] of [
  [320, 852],
  [393, 852],
  [1280, 852],
  [320, 256],
])
  test(`all date dialogs stay inside ${width}x${height} and restore keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await editor(page);
    await page.getByLabel("Дата початку", { exact: true }).fill("02.10.2026");
    await page.getByText("Повторення та сезон", { exact: true }).click();
    await page.getByLabel("Повторення", { exact: true }).selectOption("weekly");
    await page.getByText("Дати без запуску", { exact: true }).click();
    await page.getByRole("button", { name: "Додати дату без запуску", exact: true }).click();
    for (const label of ["Дата початку", "Діє до дати включно", "Пропустити дату 1"]) {
      const button = trigger(page, label);
      await button.click();
      const dialog = page.getByRole("dialog", { name: label, exact: true });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width!);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height!);
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await test
        .info()
        .attach(`date-${label}-${width}x${height}`, { body: await page.screenshot(), contentType: "image/png" });
      if (label === "Дата початку" && height === 852) {
        for (const part of ["Місяць", "Рік"]) {
          const select = dialog.getByRole("combobox", { name: part, exact: true });
          await select.click();
          const selected = await select.locator("option:checked").boundingBox();
          expect(selected!.x).toBeGreaterThanOrEqual(0);
          expect(selected!.x + selected!.width).toBeLessThanOrEqual(width!);
          expect(selected!.y).toBeGreaterThanOrEqual(0);
          expect(selected!.y + selected!.height).toBeLessThanOrEqual(height!);
          await test
            .info()
            .attach(`calendar-${part}-${width}`, { body: await page.screenshot(), contentType: "image/png" });
          await page.keyboard.press("Escape");
          await expect(dialog).toBeVisible();
          await expect(select).toBeFocused();
        }
      }
      expect(
        (await new AxeBuilder({ page }).include(".date-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await dialog.getByRole("button", { name: "Скасувати", exact: true }).focus();
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('input[type="date"], input[type="time"]')).toHaveCount(0);
  });

test("calendar keyboard crosses months and leap years, commits once and cancels without changing the draft", async ({
  page,
}) => {
  await editor(page);
  const input = page.getByLabel("Дата початку", { exact: true });
  await input.fill("31.01.2028");
  const button = trigger(page, "Дата початку");
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Дата початку", exact: true });
  await expect(dialog.locator(".calendar-day:focus")).toHaveText("31");
  await page.keyboard.press("PageDown");
  await expect(dialog.getByRole("grid")).toHaveAccessibleName("Лютий 2028");
  await expect(dialog.locator(".calendar-day:focus")).toHaveText("29");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("grid")).toHaveAccessibleName("Березень 2028");
  await expect(dialog.locator(".calendar-day:focus")).toHaveText("1");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue("01.03.2028");
  await expect(button).toBeFocused();
  await button.click();
  await page.keyboard.press("Shift+PageUp");
  await expect(dialog.getByRole("grid")).toHaveAccessibleName("Березень 2027");
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("01.03.2028");
});

test("date validation blocks impossible days and earlier end dates; preview receives ISO dates", async ({ page }) => {
  const previews: ScheduleWrite[] = [];
  await page.route(`${base}/schedules/preview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    previews.push(route.request().postDataJSON() as ScheduleWrite);
    await fulfillJson(route, 200, { runs: [], conflicts: [], conflict_horizon_days: 366, notes: [] });
  });
  await editor(page);
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Перевірка дат");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("40");
  const start = page.getByLabel("Дата початку", { exact: true });
  const preview = page.getByRole("button", { name: "Перевірити розклад", exact: true });
  await start.fill("31.02.2026");
  await preview.click();
  await expect(start).toBeFocused();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  expect(previews).toHaveLength(0);
  await start.clear();
  await start.pressSequentially("02102026");
  await expect(start).toHaveValue("02.10.2026");
  await page.getByText("Повторення та сезон", { exact: true }).click();
  await page.getByLabel("Повторення", { exact: true }).selectOption("daily");
  const until = page.getByLabel("Діє до дати включно", { exact: true });
  await until.fill("01.10.2026");
  await preview.click();
  await expect(until).toBeFocused();
  expect(previews).toHaveLength(0);
  await trigger(page, "Діє до дати включно").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /, 1 жовтня 2026/ })).toBeDisabled();
  await dialog.getByRole("button", { name: /, 3 жовтня 2026/ }).click();
  await preview.click();
  await expect(page.locator(".schedule-preview")).toBeVisible();
  expect(previews).toHaveLength(1);
  expect(previews[0]!.spec).toMatchObject({ start_date: "2026-10-02", until_date: "2026-10-03" });
  await trigger(page, "Дата початку").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /, 3 жовтня 2026/ })
    .click();
  await expect(page.locator(".schedule-preview")).toHaveCount(0);
});

test("Today follows the site timezone and an out-of-range draft cannot break calendar navigation", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-01T22:30:00Z") });
  await editor(page);
  const start = page.getByLabel("Дата початку", { exact: true });
  await start.fill("01.01.2200");
  await trigger(page, "Дата початку").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("grid")).toHaveAccessibleName("Грудень 2199");
  await expect(dialog.getByRole("button", { name: "Наступний місяць", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Сьогодні", exact: true }).click();
  await expect(start).toHaveValue("02.10.2026");
});
