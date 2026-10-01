import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { programOverview } from "../fixtures/commands";
import { API_ORIGIN, DEVICE_ID, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, viewerPermissions } from "./auth-fixtures";
import type { Schedule, ScheduleWrite } from "../../src/lib/api/schedules";

test.describe.configure({ retries: 0 });
const base = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
const conflictId = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d5";
const start = "2076-10-01T16:00:00Z", stop = "2076-10-01T23:00:00Z";
function overview() {
  const data = programOverview(), now = new Date().toISOString();
  const cap = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d6";
  data.capabilities.push({ id: cap, code: "vfd.schedule", name: "Календарні запуски", description: null, created_at: now, updated_at: now });
  data.modules.push({ assignment_id: conflictId, capability_id: cap, code: "vfd.schedule", supported: true, channels: [], command_types: ["vfd.schedule.start"], allowed_commands: ["vfd.schedule.start"] });
  data.command_types.push("vfd.schedule.start"); data.allowed_commands.push("vfd.schedule.start");
  data.diagnostics!.program!.supports_schedule = true;
  return data;
}

for (const width of [320, 393, 1280]) test(`calendar editor, preview, confirmation and F5 at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  await page.route(`${base}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, data); });
  const writes: ScheduleWrite[] = [], saved: Schedule[] = [];
  await page.route((url) => url.href.startsWith(`${base}/schedules`), async (route) => {
    if (await fulfillPreflight(route)) return;
    if (route.request().method() === "GET") return fulfillJson(route, 200, saved);
    const body = route.request().postDataJSON() as ScheduleWrite;
    if (route.request().url().endsWith("/preview")) return fulfillJson(route, 200, { runs: [{ version: 1, starts_at: start, stops_at: stop, steps: [{ frequency_hz: body.spec.frequency_hz, duration_seconds: 25200 }] }], conflicts: [], conflict_horizon_days: 366, notes: [] });
    writes.push(body);
    const row = { id: body.id, revision: body.expected_revision + 1, device_id: DEVICE_ID, organization_id: data.access.organization_id, enabled: body.enabled, spec: body.spec, next_start_at: body.enabled ? start : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    saved.splice(0, saved.length, row);
    await fulfillJson(route, 200, row);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("heading", { name: "Розклади пристрою", exact: true })).toHaveCount(0);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("schedule");
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Вечірній полив");
  await page.getByLabel("Дата початку", { exact: true }).fill("2076-10-01");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("50");
  await page.getByText("Повторення та сезон", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Жовтень", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".schedule-editor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Перевірити найближчі запуски" }).click();
  await expect(page.getByRole("region", { name: "Попередній перегляд розкладу" })).toContainText("2076");
  await page.getByRole("button", { name: "Зберегти та увімкнути" }).click();
  await expect(page.getByRole("dialog")).toContainText("автоматичні запуски");
  await page.getByRole("button", { name: "Підтвердити розклад", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator(".schedule-list")).toContainText("Вечірній полив");
  expect(writes).toHaveLength(1);
  await page.reload();
  await page.locator("summary").filter({ hasText: /^Розклади пристрою$/ }).click();
  await expect(page.locator(".schedule-list")).toContainText("Найближчий запуск");
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Призупинити", exact: true }).click();
  await page.getByRole("button", { name: "Призупинити майбутні запуски", exact: true }).click();
  await expect(page.locator(".schedule-list")).toContainText("Призупинено");
  expect(writes[1]?.expected_revision).toBe(1);
  expect(writes[1]?.enabled).toBe(false);
  await test.info().attach(`calendar-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("viewer can inspect schedules without controls or mutations", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer", permissions: viewerPermissions });
  const data = overview();
  data.access = { ...data.access, organization_role: "viewer", permissions: [...viewerPermissions] };
  data.allowed_commands = [];
  for (const capability of data.modules) capability.allowed_commands = [];
  await page.route(`${base}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, data); });
  await page.route(`${base}/schedules`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, []); });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.locator("summary").filter({ hasText: /^Розклади пристрою$/ }).click();
  await expect(page.getByText("Розкладів ще немає.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Новий розклад", exact: true })).toHaveCount(0);
});

test("unavailable capability does not fetch schedules", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let reads = 0;
  page.on("request", (request) => { if (request.url().startsWith(`${base}/schedules`)) reads++; });
  await page.route(`${base}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, programOverview()); });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("heading", { name: "Керування пристроєм", exact: true })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: /^Розклади пристрою$/ })).toHaveCount(0);
  expect(reads).toBe(0);
});
