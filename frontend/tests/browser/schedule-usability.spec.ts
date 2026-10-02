import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { ScheduleWrite } from "../../src/lib/api/schedules";
import { scheduleOverview } from "../fixtures/schedules";
import { API_ORIGIN, DEVICE_ID, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

const base = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
test.use({ locale: "ru-RU" });
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, scheduleOverview());
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
});
async function editor(page: Page) {
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByRole("tab", { name: "Розклади", exact: true }).click();
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Полив");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("35");
}
function capturePreview(page: Page) {
  const writes: ScheduleWrite[] = [];
  return page
    .route(`${base}/schedules/preview`, async (route) => {
      if (await fulfillPreflight(route)) return;
      writes.push(route.request().postDataJSON() as ScheduleWrite);
      await fulfillJson(route, 200, { runs: [], conflicts: [], notes: [], conflict_horizon_days: 366 });
    })
    .then(() => writes);
}

test("short times normalize and invalid input uses inline Ukrainian copy even in a Russian browser", async ({
  page,
}) => {
  const writes = await capturePreview(page);
  await editor(page);
  const start = page.getByLabel("Час запуску", { exact: true });
  const submit = page.getByRole("button", { name: "Перевірити розклад", exact: true });
  await start.fill("40");
  const prevented = start.evaluate(
    (element) =>
      new Promise<boolean>((resolve) => {
        element.addEventListener("invalid", (event) => queueMicrotask(() => resolve(event.defaultPrevented)), {
          once: true,
        });
      }),
  );
  await submit.click();
  expect(await prevented).toBe(true);
  await expect(start).toBeFocused();
  await expect(start).toHaveAccessibleDescription(/Вкажіть час.*6:00/);
  expect(writes).toHaveLength(0);
  await start.fill("99:99");
  await submit.click();
  expect(writes).toHaveLength(0);
  await start.fill("6:00");
  await expect(start).toHaveValue("06:00");
  await page.getByLabel("Час зупинки", { exact: true }).fill("7:00");
  await page.getByLabel("День зупинки", { exact: true }).selectOption("0");
  await submit.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]!.spec).toMatchObject({ start_time: "06:00", stop_time: "07:00" });
  await start.fill("600");
  await start.press("Enter");
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]!.spec.start_time).toBe("06:00");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("101");
  await submit.click();
  await expect(page.getByLabel("Частота за розкладом, Гц", { exact: true })).toHaveAccessibleDescription(
    /Значення має бути не більше/,
  );
  expect(writes).toHaveLength(2);
});

test("out-of-window and unordered changes reveal their field before any preview request", async ({ page }) => {
  const writes = await capturePreview(page);
  await editor(page);
  await page.getByLabel("День зупинки", { exact: true }).selectOption("0");
  await page.getByLabel("Час зупинки", { exact: true }).fill("19:30");
  const summary = page.getByText("Зміна частоти протягом роботи", { exact: true });
  await summary.click();
  await page.getByRole("button", { name: "Додати зміну частоти", exact: true }).click();
  const time = page.getByLabel("Час зміни 1", { exact: true });
  await time.fill("6:00");
  await page.getByLabel("День зміни 1", { exact: true }).selectOption("1");
  await summary.click();
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect(time).toBeVisible();
  await expect(time).toBeFocused();
  await expect(time).toHaveAccessibleDescription(/06:00.*наступного дня.*19:30.*того самого дня/);
  expect(writes).toHaveLength(0);
  await page.getByLabel("Час зупинки", { exact: true }).fill("7:00");
  await page.getByLabel("День зупинки", { exact: true }).selectOption("1");
  await expect(time).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("Час зупинки", { exact: true }).fill("19:30");
  await page.getByLabel("День зупинки", { exact: true }).selectOption("0");
  await page.getByLabel("День зміни 1", { exact: true }).selectOption("0");
  await time.fill("19:15");
  await page.getByRole("button", { name: "Додати зміну частоти", exact: true }).click();
  await page.getByLabel("Час зміни 2", { exact: true }).fill("19:14");
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect(page.getByLabel("Час зміни 2", { exact: true })).toHaveAccessibleDescription(/після попередньої зміни/);
  expect(writes).toHaveLength(0);
  await page.getByLabel("Час зміни 2", { exact: true }).fill("19:16");
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(
    (await new AxeBuilder({ page }).include(".schedule-editor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

for (const width of [320, 1280])
  test(`exclusions have spacing and returning to an empty list restores position at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await editor(page);
    await page.getByText("Дати без запуску", { exact: true }).click();
    const add = page.getByRole("button", { name: "Додати дату без запуску", exact: true });
    await add.click();
    const row = page.locator(".schedule-exclusion");
    const addBox = (await add.boundingBox())!,
      rowBox = (await row.boundingBox())!;
    expect(addBox.y - rowBox.y - rowBox.height).toBeGreaterThanOrEqual(12);
    const actions = page.locator(".schedule-editor-actions");
    const actionsBox = (await actions.boundingBox())!;
    expect(actionsBox.y - addBox.y - addBox.height).toBeGreaterThanOrEqual(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await test
      .info()
      .attach(`schedule-exclusions-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("button", { name: "До списку розкладів", exact: true }).click();
    const heading = page.getByRole("heading", { name: "Збережені розклади", exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(page.getByText("Розкладів ще немає.", { exact: true })).toBeInViewport();
    await test.info().attach(`schedule-return-${width}`, { body: await page.screenshot(), contentType: "image/png" });
  });
