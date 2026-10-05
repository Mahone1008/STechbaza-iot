import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { commandFixture, commandId, programOverview } from "../fixtures/commands";
import {
  API_ORIGIN,
  DEVICE_ID,
  corsHeaders,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  viewerPermissions,
} from "./auth-fixtures";
import { scheduleOverview as overview } from "../fixtures/schedules";
import { newScheduleSpec, type Schedule, type ScheduleWrite } from "../../src/lib/api/schedules";

test.describe.configure({ retries: 0 });
const base = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
const conflictId = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d5";
const start = "2076-10-01T16:00:00Z",
  stop = "2076-10-01T23:00:00Z";
async function openSchedules(page: Page) {
  await page.getByRole("tab", { name: "Розклади", exact: true }).click();
}

test("eight paused schedules block creation; confirmed deletion frees a slot and survives reload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 852 });
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  let saved: Schedule[] = Array.from({ length: 8 }, (_, index) => ({
    id: `f7d6f82e-ea2f-4b91-8ee9-${String(index).padStart(12, "0")}`,
    revision: 1,
    device_id: DEVICE_ID,
    organization_id: data.access.organization_id,
    enabled: false,
    spec: { ...newScheduleSpec("Europe/Kyiv", "2076-10-01"), name: `Розклад ${index + 1}`, frequency_hz: 40 },
    next_start_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  let deletes = 0;
  await page.route(
    (url) => url.href.startsWith(`${base}/schedules`),
    async (route) => {
      if (await fulfillPreflight(route)) return;
      if (route.request().method() === "DELETE") {
        deletes += 1;
        expect(route.request().url()).toBe(`${base}/schedules/${saved[0]!.id}?expected_revision=1`);
        expect(route.request().postData()).toBeNull();
        saved = saved.slice(1);
        return route.fulfill({
          status: 204,
          headers: corsHeaders,
        });
      }
      await fulfillJson(route, 200, saved);
    },
  );
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await expect(page.getByText(/Збережено 8 із 8/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Новий розклад", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Змінити", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Редагування розкладу" })).toBeVisible();
  await page.getByRole("button", { name: "До списку розкладів", exact: true }).click();
  await page.getByRole("button", { name: "Видалити", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Розклад 1");
  await expect(dialog).toContainText("STOP");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Скасувати", exact: true }).click();
  expect(deletes).toBe(0);
  await expect(page.locator(".schedule-list > li")).toHaveCount(8);
  await page.getByRole("button", { name: "Видалити", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Видалити розклад", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText(/Збережено 7 із 8/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Новий розклад", exact: true })).toBeEnabled();
  await expect(page.getByText(/Розклад видалено. Історію запусків збережено/)).toBeVisible();
  expect(deletes).toBe(1);
  await page.reload();
  await openSchedules(page);
  await expect(page.locator(".schedule-list > li")).toHaveCount(7);
  await expect(page.locator(".schedule-list")).not.toContainText("Розклад 1");
});

for (const width of [320, 393, 1280])
  test(`mode descriptions, acceptance time and open mobile controls fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await mockAuthenticatedWorkspace(page);
    await page.route(`${base}/overview`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, overview());
    });
    await page.route(`${base}/schedules`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
    });
    await page.goto(`/devices/${DEVICE_ID}`);
    const refresh = page.getByRole("combobox", { name: "Автооновлення", exact: true });
    await refresh.click();
    for (const option of await refresh.getByRole("option").all()) {
      const box = await option.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await test.info().attach(`refresh-open-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await refresh.selectOption("0");
    await page.getByText("Додаткові налаштування команди", { exact: true }).click();
    const ttl = page.getByLabel("Час на прийняття команди, с", { exact: true });
    const mode = page.getByRole("combobox", { name: "Режим роботи", exact: true });
    await ttl.fill("57");
    for (const [value, description] of [
      ["manual", "Ви самі запускаєте й зупиняєте насос"],
      ["timer", "Робота на одній частоті від 10 с до 24 год"],
      ["program", "До 8 послідовних етапів"],
      ["schedule", "Автоматичний запуск і зупинка у вибраний час"],
    ]) {
      await mode.selectOption(value!);
      await expect(mode).toHaveAccessibleDescription(new RegExp(description!));
      await expect(ttl).toBeVisible();
      await expect(ttl).toHaveValue("57");
      const ttlBox = await ttl.boundingBox(),
        modeBox = await mode.boundingBox();
      expect(ttlBox!.y + ttlBox!.height).toBeLessThan(modeBox!.y);
      await expect(page.locator(".schedule-panel")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(ttl).toHaveAccessibleDescription(/STOP.*30 с від запланованого часу/);
    await mode.scrollIntoViewIfNeeded();
    await test.info().attach(`schedule-mode-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("tab", { name: "Розклади", exact: true }).click();
    await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
    await page.getByText("Зміна частоти протягом роботи", { exact: true }).click();
    await page.getByRole("button", { name: "Додати зміну частоти", exact: true }).click();
    for (const label of ["Час запуску", "Час зупинки", "Час зміни 1"]) {
      const input = page.getByLabel(label, { exact: true });
      await input.clear();
      await input.pressSequentially("1930");
      await expect(input).toHaveValue("19:30");
      await expect(input).toHaveAttribute("inputmode", "numeric");
      const box = await input.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await test
      .info()
      .attach(`change-time-focused-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

test("schedule time fields reject invalid and missing times before preview", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, overview());
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  const previews: ScheduleWrite[] = [];
  await page.route(`${base}/schedules/preview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    previews.push(route.request().postDataJSON() as ScheduleWrite);
    await fulfillJson(route, 200, { runs: [], conflicts: [], conflict_horizon_days: 366, notes: [] });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Перевірка часу");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("40");
  const startTime = page.getByLabel("Час запуску", { exact: true });
  const submit = page.getByRole("button", { name: "Перевірити розклад", exact: true });
  await startTime.fill("25:60");
  await submit.click();
  await expect(startTime).toBeFocused();
  expect(previews).toHaveLength(0);
  await startTime.fill("19:00");
  await page.getByLabel("Час зупинки", { exact: true }).fill("23:59");
  await page.getByText("Зміна частоти протягом роботи", { exact: true }).click();
  await page.getByRole("button", { name: "Додати зміну частоти", exact: true }).click();
  const changeTime = page.getByLabel("Час зміни 1", { exact: true });
  await changeTime.clear();
  await page.getByLabel("Нова частота 1, Гц", { exact: true }).fill("30");
  await submit.click();
  await expect(changeTime).toBeFocused();
  expect(previews).toHaveLength(0);
  await changeTime.fill("23:00");
  await submit.click();
  await expect(page.locator(".schedule-preview")).toBeVisible();
  expect(previews).toHaveLength(1);
  expect(previews[0]?.spec).toMatchObject({ start_time: "19:00", stop_time: "23:59", changes: [{ at: "23:00" }] });
  await changeTime.fill("22:00");
  await expect(page.locator(".schedule-preview")).toHaveCount(0);
});

for (const width of [320, 393, 1280])
  test(`calendar editor, preview, confirmation and F5 at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await mockAuthenticatedWorkspace(page);
    const data = overview();
    await page.route(`${base}/overview`, async (route) => {
      if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
    });
    const writes: ScheduleWrite[] = [],
      saved: Schedule[] = [];
    await page.route(
      (url) => url.href.startsWith(`${base}/schedules`),
      async (route) => {
        if (await fulfillPreflight(route)) return;
        if (route.request().method() === "GET") return fulfillJson(route, 200, saved);
        const body = route.request().postDataJSON() as ScheduleWrite;
        if (route.request().url().endsWith("/preview"))
          return fulfillJson(route, 200, {
            runs: [
              {
                version: 1,
                starts_at: start,
                stops_at: stop,
                steps: [{ frequency_hz: body.spec.frequency_hz, duration_seconds: 25200 }],
              },
            ],
            conflicts: [],
            conflict_horizon_days: 366,
            notes: [],
          });
        writes.push(body);
        const row = {
          id: body.id,
          revision: body.expected_revision + 1,
          device_id: DEVICE_ID,
          organization_id: data.access.organization_id,
          enabled: body.enabled,
          spec: body.spec,
          next_start_at: body.enabled ? start : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        saved.splice(0, saved.length, row);
        await fulfillJson(route, 200, row);
      },
    );
    await page.goto(`/devices/${DEVICE_ID}`);
    await expect(page.locator(".schedule-panel")).toHaveCount(0);
    await openSchedules(page);
    await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
    await page.getByLabel("Назва розкладу", { exact: true }).fill("Вечірній полив");
    await page.getByLabel("Дата початку", { exact: true }).fill("2076-10-01");
    await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("50");
    await page.getByText("Повторення та сезон", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Жовтень", exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Повторення", exact: true }).selectOption("daily");
    await expect(page.getByRole("checkbox", { name: "Жовтень", exact: true })).toBeChecked();
    await page.getByRole("combobox", { name: "Повторення", exact: true }).selectOption("once");
    await test.info().attach(`calendar-editor-${width}`, {
      body: await page.locator(".schedule-editor").screenshot(),
      contentType: "image/png",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include(".schedule-editor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
    await expect(page.getByRole("region", { name: "Попередній перегляд розкладу" })).toContainText("2076");
    await page.getByRole("button", { name: "Зберегти та увімкнути" }).click();
    await expect(page.getByRole("dialog")).toContainText("автоматичні запуски");
    await page
      .getByRole("button", { name: "Підтвердити розклад", exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect(page.locator(".schedule-list")).toContainText("Вечірній полив");
    expect(writes).toHaveLength(1);
    await page.reload();
    await openSchedules(page);
    await expect(page.locator(".schedule-list")).toContainText("Найближчий запуск");
    expect(writes).toHaveLength(1);
    await page.getByRole("button", { name: "Призупинити", exact: true }).click();
    await page.getByRole("button", { name: "Призупинити майбутні запуски", exact: true }).click();
    await expect(page.locator(".schedule-list")).toContainText("Призупинено");
    expect(writes[1]?.expected_revision).toBe(1);
    expect(writes[1]?.enabled).toBe(false);
    await test
      .info()
      .attach(`calendar-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });

test("viewer can inspect schedules without controls or mutations", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer", permissions: viewerPermissions });
  const data = overview();
  data.access = { ...data.access, organization_role: "viewer", permissions: [...viewerPermissions] };
  data.allowed_commands = [];
  for (const capability of data.modules) capability.allowed_commands = [];
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, [
        {
          id: conflictId,
          revision: 1,
          device_id: DEVICE_ID,
          organization_id: data.access.organization_id,
          enabled: false,
          spec: { ...newScheduleSpec("Europe/Kyiv", "2076-10-01"), name: "Доступний читачу", frequency_hz: 40 },
          next_start_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await expect(page.locator(".schedule-list")).toContainText("Доступний читачу");
  await expect(page.getByRole("button", { name: "Новий розклад", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Змінити|Видалити|Увімкнути)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Історія запусків", exact: true })).toBeVisible();
});

test("unavailable capability does not fetch schedules", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().startsWith(`${base}/schedules`)) reads++;
  });
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, programOverview());
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("heading", { name: "Керування пристроєм", exact: true })).toBeVisible();
  await expect(page.locator(".schedule-panel")).toHaveCount(0);
  expect(reads).toBe(0);
});

test("schedule tab preserves its draft and suspends every hidden request", async ({ page }) => {
  await page.clock.install();
  await mockAuthenticatedWorkspace(page);
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, overview());
  });
  let reads = 0,
    writes = 0;
  await page.route(`${base}/schedules`, async (route) => {
    if (await fulfillPreflight(route)) return;
    if (route.request().method() === "GET") reads++;
    else writes++;
    await fulfillJson(route, 200, []);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("tab", { name: "Панель", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(reads).toBe(0);
  await openSchedules(page);
  await expect(page.getByText("Розкладів ще немає.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Незбережений полив");
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  await expect(page.locator(".schedule-panel")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeVisible();
  const hiddenReads = reads;
  await page.clock.fastForward(61_000);
  expect(reads).toBe(hiddenReads);
  await page.getByRole("tab", { name: "Розклади", exact: true }).click();
  await expect(page.getByLabel("Назва розкладу", { exact: true })).toHaveValue("Незбережений полив");
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByRole("combobox", { name: "Режим роботи", exact: true }).selectOption("timer");
  await expect(page.getByText("Робота за таймером", { exact: true })).toBeVisible();
  const switchedReads = reads;
  await page.clock.fastForward(61_000);
  expect(reads).toBe(switchedReads);
  expect(writes).toBe(0);
});

test("a running plan still allows calendar inspection and STOP but not another program", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  data.diagnostics!.program = {
    ...data.diagnostics!.program!,
    command_id: conflictId,
    state: "holding",
    step_index: 1,
    step_count: 1,
    target_frequency_hz: 20,
    remaining_seconds: 50,
  };
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await expect(page.getByText("Розкладів ще немає.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  const mode = page.getByRole("combobox", { name: "Режим роботи", exact: true });
  await expect(mode.locator('option[value="timer"]')).toHaveJSProperty("disabled", true);
  await expect(mode.locator('option[value="program"]')).toHaveJSProperty("disabled", true);
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Задати частоту", exact: true })).toBeDisabled();
});

test("preview is invalidated by edits and conflicts prevent saving", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  let conflict = false;
  await page.route(`${base}/schedules/preview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, {
      runs: [{ version: 1, starts_at: start, stops_at: stop, steps: [{ frequency_hz: 40, duration_seconds: 25200 }] }],
      conflicts: conflict ? [conflictId] : [],
      conflict_horizon_days: 366,
      notes: [],
    });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Полив");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect(page.getByRole("button", { name: "Зберегти та увімкнути", exact: true })).toBeEnabled();
  await page.getByLabel("Час запуску", { exact: true }).fill("18:00");
  await expect(page.getByRole("button", { name: "Зберегти та увімкнути", exact: true })).toHaveCount(0);
  conflict = true;
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect(page.getByRole("button", { name: "Зберегти та увімкнути", exact: true })).toBeDisabled();
  await expect(page.locator(".schedule-preview")).toContainText("Є перетин");
});

test("required fields and frequency limits are checked before calendar preview", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  let previews = 0;
  await page.route(`${base}/schedules/preview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    previews++;
    await fulfillJson(route, 200, { runs: [], conflicts: [], conflict_horizon_days: 366, notes: [] });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  const preview = page.getByRole("button", { name: "Перевірити розклад", exact: true });
  await preview.click();
  await expect(page.getByLabel("Назва розкладу", { exact: true })).toBeFocused();
  expect(previews).toBe(0);
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Полив");
  const frequency = page.getByRole("spinbutton", { name: "Частота за розкладом, Гц", exact: true });
  await expect(frequency).toHaveAccessibleDescription(/Робочі межі: 20–50 Гц/);
  await frequency.fill("60");
  await preview.click();
  await expect(frequency).toBeFocused();
  expect(previews).toBe(0);
  await frequency.fill("40");
  await preview.click();
  await expect(page.locator(".schedule-preview")).toContainText("немає майбутніх коректних запусків");
  expect(previews).toBe(1);
  await expect(page.getByRole("button", { name: "Зберегти та увімкнути", exact: true })).toBeDisabled();
});

test("closing the calendar stops both list and selected history polling", async ({ page }) => {
  await page.clock.install();
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  const item = {
    id: conflictId,
    revision: 1,
    device_id: DEVICE_ID,
    organization_id: data.access.organization_id,
    enabled: true,
    spec: { ...newScheduleSpec("Europe/Kyiv", "2076-10-01"), name: "Полив", frequency_hz: 40 },
    next_start_at: start,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  let lists = 0,
    histories = 0;
  await page.route(`${base}/schedules`, async (route) => {
    if (await fulfillPreflight(route)) return;
    lists++;
    await fulfillJson(route, 200, [item]);
  });
  await page.route(`${base}/schedules/${conflictId}/runs`, async (route) => {
    if (await fulfillPreflight(route)) return;
    histories++;
    await fulfillJson(route, 200, []);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await page.getByRole("button", { name: "Історія запусків", exact: true }).click();
  await expect(page.getByText("Запусків ще не було.", { exact: true })).toBeVisible();
  expect(histories).toBe(1);
  await page.getByRole("tab", { name: "Панель", exact: true }).click();
  await expect(page.locator(".schedule-panel")).not.toBeVisible();
  const counts = [lists, histories];
  await page.clock.fastForward(61_000);
  expect([lists, histories]).toEqual(counts);
  await page.getByRole("tab", { name: "Розклади", exact: true }).click();
  await expect(page.getByText("Запусків ще не було.", { exact: true })).toBeVisible();
  expect(histories).toBeGreaterThan(counts[1]!);
});

test("manual and minute refresh apply to schedules, run history and command records", async ({ page }) => {
  await page.clock.install();
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  const item = {
    id: conflictId,
    revision: 1,
    device_id: DEVICE_ID,
    organization_id: data.access.organization_id,
    enabled: true,
    spec: { ...newScheduleSpec("Europe/Kyiv", "2076-10-01"), name: "Полив", frequency_hz: 40 },
    next_start_at: start,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const counts = { overview: 0, lists: 0, histories: 0, journal: 0, detail: 0 };
  for (const [url, key, response] of [
    [`${base}/overview`, "overview", data],
    [`${base}/schedules`, "lists", [item]],
    [`${base}/schedules/${conflictId}/runs`, "histories", []],
    [`${base}/commands?*`, "journal", [commandFixture()]],
    [`${API_ORIGIN}/api/v1/commands/${commandId}`, "detail", commandFixture()],
  ] as const) {
    await page.route(url, async (route) => {
      if (await fulfillPreflight(route)) return;
      counts[key]++;
      await fulfillJson(route, 200, response);
    });
  }
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("tab", { name: "Журнал", exact: true }).click();
  await page.getByRole("link", { name: "Переглянути команду Запустити", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Стан вибраної команди", exact: true })).toBeVisible();
  await openSchedules(page);
  await page.getByRole("button", { name: "Історія запусків", exact: true }).click();
  await expect(page.getByText("Запусків ще не було.", { exact: true })).toBeVisible();
  const refresh = page.getByLabel("Автооновлення", { exact: true });
  await refresh.selectOption("0");
  const beforeManual = { ...counts };
  await page.clock.fastForward(61_000);
  expect(counts).toEqual(beforeManual);
  for (const [label, key] of [
    ["Оновити розклади", "lists"],
    ["Оновити історію запусків", "histories"],
    ["Оновити панель", "overview"],
  ] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => counts[key]).toBe(beforeManual[key] + 1);
  }
  await page.getByRole("tab", { name: "Журнал", exact: true }).click();
  await expect(page.getByRole("button", { name: "Оновити стан команди", exact: true })).toBeEnabled();
  const beforeJournal = { ...counts };
  for (const [label, key] of [
    ["Оновити журнал", "journal"],
    ["Оновити стан команди", "detail"],
  ] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => counts[key]).toBe(beforeJournal[key] + 1);
  }
  await refresh.selectOption("60");
  await expect(page.getByRole("button", { name: "Оновити стан команди", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Оновити журнал", exact: true })).toBeEnabled();
  const beforeMinute = { ...counts };
  await page.clock.fastForward(31_000);
  expect(counts).toEqual(beforeMinute);
  await page.clock.fastForward(30_000);
  await expect
    .poll(() => counts)
    .toEqual({
      ...beforeMinute,
      journal: beforeMinute.journal + 1,
      detail: beforeMinute.detail + 1,
    });
});

test("week-long rule previews, confirms and keeps all day offsets after reload", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  const saved: Schedule[] = [];
  await page.route(
    (url) => url.href.startsWith(`${base}/schedules`),
    async (route) => {
      if (await fulfillPreflight(route)) return;
      if (route.request().method() === "GET") return fulfillJson(route, 200, saved);
      const body = route.request().postDataJSON() as ScheduleWrite;
      expect(body.spec.stop_day_offset).toBe(7);
      expect(body.spec.changes?.[0]?.day_offset).toBe(3);
      if (route.request().url().endsWith("/preview"))
        return fulfillJson(route, 200, {
          runs: [
            {
              version: 1,
              starts_at: start,
              stops_at: "2076-10-08T16:00:00Z",
              steps: [
                { frequency_hz: 40, duration_seconds: 259200 },
                { frequency_hz: 30, duration_seconds: 345600 },
              ],
            },
          ],
          conflicts: [],
          conflict_horizon_days: 366,
          notes: [],
        });
      saved.push({
        id: body.id,
        revision: 1,
        device_id: DEVICE_ID,
        organization_id: data.access.organization_id,
        enabled: true,
        spec: body.spec,
        next_start_at: start,
        created_at: start,
        updated_at: start,
      });
      return fulfillJson(route, 200, saved[0]);
    },
  );
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await page.getByRole("button", { name: "Новий розклад", exact: true }).click();
  await expect(page.getByRole("form", { name: "Редактор розкладу" })).toContainText(
    "Після підтвердження розклад запуститься автоматично",
  );
  await page.getByLabel("Назва розкладу", { exact: true }).fill("Тижневий запуск");
  await page.getByLabel("Дата початку", { exact: true }).fill("2076-10-01");
  await page.getByLabel("День зупинки", { exact: true }).selectOption("7");
  await page.getByLabel("Час зупинки", { exact: true }).fill("19:00");
  await page.getByLabel("Частота за розкладом, Гц", { exact: true }).fill("40");
  await page.getByText("Зміна частоти протягом роботи", { exact: true }).click();
  await page.getByRole("button", { name: "Додати зміну частоти", exact: true }).click();
  await page.getByLabel("Час зміни 1", { exact: true }).fill("19:00");
  await page.getByLabel("День зміни 1", { exact: true }).selectOption("3");
  await page.getByLabel("Нова частота 1, Гц", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Перевірити розклад", exact: true }).click();
  await expect(page.getByRole("region", { name: "Попередній перегляд розкладу" })).toContainText("08.10.2076");
  await page.getByRole("button", { name: "Зберегти та увімкнути", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("через 7 днів");
  await page.getByRole("button", { name: "Підтвердити розклад", exact: true }).click();
  await expect(page.locator(".schedule-list")).toContainText("через 7 днів");
  await page.reload();
  await openSchedules(page);
  await page.getByRole("button", { name: "Змінити", exact: true }).click();
  await expect(page.getByLabel("День зупинки", { exact: true })).toHaveValue("7");
  await page.getByText("Зміна частоти протягом роботи", { exact: true }).click();
  await expect(page.getByLabel("День зміни 1", { exact: true })).toHaveValue("3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await test.info().attach("week-calendar-393", {
    body: await page.locator(".schedule-editor").screenshot(),
    contentType: "image/png",
  });
});

test("legacy calendar firmware explains its one-day duration limit", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = overview();
  data.diagnostics!.program!.max_schedule_seconds = 86400;
  await page.route(`${base}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${base}/schedules`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await openSchedules(page);
  await expect(page.locator(".schedule-panel")).toContainText("Поточна прошивка підтримує запуск до 24 год");
  await expect(page.locator(".schedule-panel")).toContainText("оновіть контролер до 0.5.0");
});
