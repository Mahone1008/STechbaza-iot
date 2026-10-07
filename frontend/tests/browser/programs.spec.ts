import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { commandFixture, commandId, programOverview } from "../fixtures/commands";
import type { CommandInput } from "../../src/lib/api/commands";
import {
  API_ORIGIN,
  DEVICE_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  viewerPermissions,
} from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const url = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, programOverview());
  });
  await page.route(`${API_ORIGIN}/api/v1/commands/${commandId}`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, commandFixture({ command_type: "vfd.program.start", status: "acknowledged" }));
  });
});

for (const width of [320, 393, 1280])
  test(`program editor is collapsed by default and fits ${width}px`, async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Запустити за етапами", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".program-settings")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await test
      .info()
      .attach(`program-editor-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByText("Додаткові налаштування команди", { exact: true }).click();
    await expect(page.locator(".program-mode-notice")).toContainText("За етапами · етапів: 2");
    await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeVisible();
  });

test("timer confirmation sends one complete plan with separate TTL and validates nested receipt", async ({ page }) => {
  const posts: CommandInput[] = [];
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON();
    posts.push(input);
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
  await expect(page.getByRole("dialog")).toContainText("Запуск за таймером");
  await expect(page.getByRole("dialog")).toContainText("Час на прийняття команди: 30 с");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Надіслати команду" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByText("Команду прийнято. Очікуємо результат від контролера.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("program");
  await expect(
    page.getByText("Команду прийнято. Очікуємо результат від контролера.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Стан вибраної команди", exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    command_type: "vfd.program.start",
    ttl_seconds: 30,
    payload: { version: 1, steps: [{ frequency_hz: 40, duration_seconds: 7200 }] },
  });
});

test("timer and stages have separate drafts, help and action labels", async ({ page }) => {
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  const mode = page.getByRole("combobox", { name: "Режим роботи", exact: true });
  await mode.selectOption("program");
  await page.getByLabel("Частота етапу 1, Гц", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Додати етап", exact: true }).click();
  await page.getByLabel("Частота етапу 2, Гц", { exact: true }).fill("50");
  await mode.selectOption("timer");
  await expect(page.getByLabel("Частота, Гц", { exact: true })).toHaveValue("");
  await expect(page.locator(".work-mode-settings")).toContainText("Робота на одній частоті від 10 с до 24 год");
  await expect(page.locator(".work-mode-settings")).not.toContainText("8 послідовних етапів");
  await expect(page.getByRole("button", { name: "Запустити за таймером", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Запустити за етапами", exact: true })).toHaveCount(0);
  await page.getByLabel("Частота, Гц", { exact: true }).fill("40");
  await page.getByLabel("Хвилини", { exact: true }).fill("2");
  await mode.selectOption("program");
  await expect(page.getByLabel("Частота етапу 1, Гц", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("Частота етапу 2, Гц", { exact: true })).toHaveValue("50");
  await expect(page.locator(".work-mode-settings")).toContainText("До 8 послідовних етапів");
  await mode.selectOption("timer");
  await expect(page.getByLabel("Частота, Гц", { exact: true })).toHaveValue("40");
  await expect(page.getByLabel("Хвилини", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Запустити на 2 хв", exact: true }).click();
  await expect(page.getByRole("dialog").locator(".program-summary li")).toHaveText(["40 Гц · 2 хв"]);
});

test("F5 restores every saved stage without issuing commands and leaves STOP available", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const data = programOverview();
  data.diagnostics!.program = {
    ...data.diagnostics!.program!,
    command_id: commandId,
    state: "holding",
    step_index: 2,
    step_count: 3,
    target_frequency_hz: 40,
    remaining_seconds: 3590,
  };
  const command = commandFixture({
    command_type: "vfd.program.start",
    status: "acknowledged",
    payload: {
      version: 1,
      steps: [
        { frequency_hz: 20, duration_seconds: 60 },
        { frequency_hz: 40, duration_seconds: 3600 },
        { frequency_hz: 50, duration_seconds: 30 },
      ],
    },
  });
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${API_ORIGIN}/api/v1/commands/${commandId}`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, command);
  });
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/commands")) posts++;
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.locator("#device-section-panel .program-summary li")).toHaveText([
    "20 Гц · 1 хв",
    "40 Гц · 1 год",
    "50 Гц · 30 с",
  ]);
  data.diagnostics!.program!.remaining_seconds = 3580;
  await page.reload();
  await expect(page.locator("#device-section-panel .program-summary li")).toHaveText([
    "20 Гц · 1 хв",
    "40 Гц · 1 год",
    "50 Гц · 30 с",
  ]);
  await expect(page.getByRole("heading", { name: "Виконання етапів", exact: true })).toBeVisible();
  await expect(page.getByText("Етап 2 з 3 · 40 Гц.", { exact: true })).toBeVisible();
  await expect(page.getByText("Залишок етапу за повідомленням контролера: 59 хв 40 с.", { exact: true })).toBeVisible();
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Режим роботи", exact: true })).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: /Частота|Задана частота/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await test.info().attach("program-restored-after-f5-393", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(posts).toBe(0);

  const stopId = "c8f2f2d6-e380-492a-a9dc-d0b9ba792136";
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    expect(route.request().postDataJSON().command_type).toBe("vfd.stop");
    await fulfillJson(route, 201, commandFixture({ ...route.request().postDataJSON(), id: stopId }));
  });
  await page.route(`${API_ORIGIN}/api/v1/commands/${stopId}`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, commandFixture({ id: stopId, command_type: "vfd.stop", status: "succeeded" }));
  });
  await page.getByRole("button", { name: "Зупинити", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду", exact: true }).click();
  await expect(page.locator("#device-section-panel")).toContainText("Контролер повідомив про виконання");
  await page.getByRole("link", { name: "Переглянути етапи роботи", exact: true }).click();
  await expect(page.locator("#selected-command .program-summary li")).toHaveText([
    "20 Гц · 1 хв",
    "40 Гц · 1 год",
    "50 Гц · 30 с",
  ]);
  expect(posts).toBe(1);
});

for (const canReadCommands of [true, false])
  test(`restored program respects command.read=${canReadCommands}`, async ({ page }) => {
    const permissions = viewerPermissions.filter((permission) => canReadCommands || permission !== "command.read");
    await mockAuthenticatedWorkspace(page, { role: "viewer", permissions });
    const data = programOverview();
    data.access = { ...data.access, organization_role: "viewer", permissions };
    data.allowed_commands = [];
    for (const capability of data.modules) capability.allowed_commands = [];
    data.diagnostics!.program = {
      ...data.diagnostics!.program!,
      command_id: commandId,
      state: "holding",
      step_index: 1,
      step_count: 1,
      target_frequency_hz: 20,
      remaining_seconds: 15,
    };
    await page.route(`${url}/overview`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
    });
    let reads = 0;
    await page.route(`${API_ORIGIN}/api/v1/commands/${commandId}`, async (route) => {
      if (await fulfillPreflight(route)) return;
      reads++;
      await fulfillJson(
        route,
        200,
        commandFixture({
          command_type: "vfd.program.start",
          status: "acknowledged",
          payload: { version: 1, steps: [{ frequency_hz: 20, duration_seconds: 60 }] },
        }),
      );
    });
    await page.goto(`/devices/${DEVICE_ID}`);
    await expect(page.getByText("Етап 1 з 1 · 20 Гц.", { exact: true })).toBeVisible();
    if (canReadCommands) {
      await expect(page.locator("#device-section-panel .program-summary li")).toHaveText(["20 Гц · 1 хв"]);
      await expect(page.getByRole("link", { name: "Переглянути етапи роботи", exact: true })).toBeVisible();
      expect(reads).toBeGreaterThan(0);
    } else {
      await expect(page.getByRole("link", { name: "Переглянути етапи роботи", exact: true })).toHaveCount(0);
      await expect(page.locator("#device-section-panel .program-summary")).toHaveCount(0);
      expect(reads).toBe(0);
    }
    await expect(page.getByRole("button", { name: "Запустити", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toHaveCount(0);
  });

test("an old firmware and stale status cannot enable a program", async ({ page }) => {
  let data = programOverview();
  data.diagnostics!.program = null;
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Режим роботи", exact: true }).locator('option[value="timer"]'),
  ).toHaveJSProperty("disabled", true);
  data = programOverview();
  data.diagnostics!.program!.ready = false;
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("timer");
  await page.getByLabel("Частота, Гц", { exact: true }).fill("40");
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeDisabled();
  data.diagnostics!.program!.ready = true;
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeEnabled();
  data.telemetry_freshness.status = "stale";
  data.telemetry_freshness.reason = "timeout";
  data.telemetry_freshness.received_age_seconds = 1000;
  for (const reading of [...data.readings, ...data.state_readings])
    if (reading.status === "fresh") reading.status = "stale";
  await page.getByRole("button", { name: "Оновити панель", exact: true }).click();
  await expect(page.getByRole("button", { name: "Запустити на 1 хв", exact: true })).toBeDisabled();
});
