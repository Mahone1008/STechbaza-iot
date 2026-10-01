import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { commandFixture, commandId, programOverview } from "../fixtures/commands";
import type { CommandInput } from "../../src/lib/api/commands";
import { API_ORIGIN, DEVICE_ID, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const url = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${url}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, programOverview()); });
  await page.route(`${API_ORIGIN}/api/v1/commands/${commandId}`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, commandFixture({ command_type: "vfd.program.start", status: "acknowledged" })); });
});

for (const width of [320, 393, 1280]) test(`program editor is collapsed by default and fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("combobox", { name: "Режим роботи", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeVisible();
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("program");
  await page.getByLabel("Частота етапу 1, Гц", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Додати етап", exact: true }).click();
  await page.getByLabel("Частота етапу 2, Гц", { exact: true }).fill("50");
  await page.getByLabel("Години · етап 1", { exact: true }).fill("2");
  await page.getByLabel("Хвилини · етап 1", { exact: true }).fill("0");
  await expect(page.getByRole("button", { name: "Запустити програму", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".program-settings").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await test.info().attach(`program-editor-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await expect(page.locator(".program-mode-notice")).toContainText("Програма · етапів: 2");
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeVisible();
});

test("timer confirmation sends one complete plan with separate TTL and validates nested receipt", async ({ page }) => {
  const posts: CommandInput[] = [];
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON(); posts.push(input);
    await fulfillJson(route, 201, commandFixture(input));
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("timer");
  await page.getByLabel("Частота, Гц", { exact: true }).fill("40");
  await page.getByLabel("Години", { exact: true }).fill("2");
  await page.getByLabel("Хвилини", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Запустити на 2 год", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("40 Гц · 2 год");
  await expect(page.getByRole("dialog")).toContainText("Час на прийняття команди: 30 с");
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText("Сервер прийняв команду. Перевіряємо повідомлення контролера нижче.", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ command_type: "vfd.program.start", ttl_seconds: 30, payload: { version: 1, steps: [{ frequency_hz: 40, duration_seconds: 7200 }] } });
});

test("F5 restores controller progress without issuing commands and leaves STOP available", async ({ page }) => {
  const data = programOverview();
  data.diagnostics!.program = { ...data.diagnostics!.program!, command_id: commandId, state: "holding", step_index: 2, step_count: 3, target_frequency_hz: 40, remaining_seconds: 3590 };
  await page.route(`${url}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, data); });
  let posts = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/commands")) posts++; });
  await page.goto(`/devices/${DEVICE_ID}`); await page.reload();
  await expect(page.getByRole("heading", { name: "Виконання програми", exact: true })).toBeVisible();
  await expect(page.getByText("Етап 2 з 3 · 40 Гц.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  expect(posts).toBe(0);
});

test("an old firmware and stale status cannot enable a program", async ({ page }) => {
  let data = programOverview(); data.diagnostics!.program = null;
  await page.route(`${url}/overview`, async (route) => { if (!await fulfillPreflight(route)) await fulfillJson(route, 200, data); });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Режим роботи", exact: true }).locator('option[value="timer"]')).toHaveJSProperty("disabled", true);
  data = programOverview(); data.diagnostics!.program!.ready = false;
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("timer");
  await page.getByLabel("Частота, Гц", { exact: true }).fill("40");
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeDisabled();
  data.diagnostics!.program!.ready = true;
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeEnabled();
  data.telemetry_freshness.status = "stale"; data.telemetry_freshness.reason = "timeout"; data.telemetry_freshness.received_age_seconds = 1000;
  for (const reading of [...data.readings, ...data.state_readings]) if (reading.status === "fresh") reading.status = "stale";
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeDisabled();
});
