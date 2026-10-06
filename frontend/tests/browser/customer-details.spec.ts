import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { commandFixture, controlOverview } from "../fixtures/commands";
import { alarmFixture } from "../fixtures/alarms";
import {
  API_ORIGIN,
  DEVICE_ID,
  SESSION_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";
import {
  alarmTypeFilter,
  recoveryPasswordProof,
  revealSection,
  securityPasswordProof,
} from "../helpers/customer-details";

test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, controlOverview());
  });
  await page.route(`${API_ORIGIN}/api/v1/auth/security`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, {
      mfa_enabled: false,
      privileged_mfa_required: false,
      current_session_verified: false,
      recovery_available: true,
    });
  });
  await page.route(`${API_ORIGIN}/api/v1/auth/sessions`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, [
      {
        id: SESSION_ID,
        current: true,
        created_at: "2026-10-06T12:00:00Z",
        expires_at: "2027-01-01T00:00:00Z",
        last_used_at: null,
      },
    ]);
  });
});

for (const width of [320, 390, 768, 1440]) {
  test(`display settings reveal by keyboard and preserve the frequency draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/devices/${DEVICE_ID}`);
    const input = page.getByLabel("Автооновлення", { exact: true });
    await expect(input).toBeHidden();
    await expect(page.getByRole("heading", { name: "Обладнання зупинено", exact: true })).toBeVisible();
    const frequency = page.getByLabel("Задана частота, Гц");
    await frequency.fill("40.5");
    const summary = page.getByText("Налаштування відображення", { exact: true });
    const stop = await page.getByRole("button", { name: "Зупинити", exact: true }).boundingBox();
    const settings = await summary.boundingBox();
    expect(stop!.y + stop!.height).toBeLessThanOrEqual(settings!.y);
    await summary.focus();
    await summary.press("Enter");
    await expect(input).toBeVisible();
    await input.selectOption("30");
    await summary.focus();
    await summary.press("Enter");
    await expect(input).toBeHidden();
    await expect(frequency).toHaveValue("40.5");
    await summary.press("Enter");
    await expect(input).toHaveValue("30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("uncertain command result remains visible while delivery details are collapsed", async ({ page }) => {
  let command = commandFixture({
    status: "result_unknown",
    acknowledged_at: "2026-09-28T12:00:01Z",
    result_timed_out_at: "2026-09-28T12:02:01Z",
  });
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    command = commandFixture({ ...route.request().postDataJSON(), status: "result_unknown", acknowledged_at: "2026-09-28T12:00:01Z", result_timed_out_at: "2026-09-28T12:02:01Z" });
    await fulfillJson(route, 201, command);
  });
  await page.route(`${API_ORIGIN}/api/v1/commands/${command.id}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, command);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "Зупинити", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду", exact: true }).click();
  const card = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "Стан вибраної команди", exact: true }) });
  await expect(card.getByText("Результат невідомий", { exact: true })).toBeVisible();
  await expect(card.getByText(/Контролер не надіслав результат вчасно/)).toBeVisible();
  await expect(card.locator(".command-lifecycle")).toBeHidden();
  await card.getByText("Доставка та час виконання", { exact: true }).click();
  await expect(card.locator(".command-lifecycle")).toContainText("Контролер підтвердив прийом");
  await expect(card.getByText(/Час на прийняття команди/)).toBeVisible();
});

test("security actions keep drafts, expose only the chosen form and retain an unsaved recovery key", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const recovery = "r".repeat(43);
  await page.route(`${API_ORIGIN}/api/v1/auth/security/recovery`, async (route) => {
    if (await fulfillPreflight(route)) return;
    expect(route.request().postDataJSON()).toEqual({ password: "example-password-123", otp: null });
    await fulfillJson(route, 200, { recovery_key: recovery });
  });
  await page.goto("/account/security");
  await expect(page.getByLabel("Новий пароль", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Поточний пароль для підтвердження", { exact: true })).toBeHidden();
  await expect(page.getByText("Поточна сесія", { exact: true })).toBeHidden();
  await securityPasswordProof(page);
  await page.getByLabel("Новий пароль", { exact: true }).fill("example-new-password-456");
  await (await recoveryPasswordProof(page)).fill("example-password-123");
  await expect(page.getByLabel("Новий пароль", { exact: true })).toBeHidden();
  await securityPasswordProof(page);
  await expect(page.getByLabel("Новий пароль", { exact: true })).toHaveValue("example-new-password-456");
  await recoveryPasswordProof(page);
  await page.getByRole("button", { name: "Створити новий ключ відновлення", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  await expect(page.locator(".recovery-result")).toBeFocused();
  await page.getByText("Створення нового ключа", { exact: true }).click();
  await revealSection(page, "Переглянути активні сесії");
  await expect(page.getByText("Поточна сесія", { exact: true })).toBeVisible();
  await expect(page.locator(".recovery-key")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: "Я зберіг ключ", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
});

test("an action error reopens a form closed during the request and receives focus", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route(`${API_ORIGIN}/api/v1/auth/security/password`, async (route) => {
    if (await fulfillPreflight(route)) return;
    started = true;
    await gate;
    await fulfillJson(route, 422, { detail: "Пароль не відповідає вимогам" });
  });
  await page.goto("/account/security");
  await (await securityPasswordProof(page)).fill("example-password-123");
  await page.getByLabel("Новий пароль", { exact: true }).fill("example-new-password-456");
  await page.getByLabel("Повторіть новий пароль", { exact: true }).fill("example-new-password-456");
  await page.getByRole("button", { name: "Змінити пароль", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByText("Зміна пароля", { exact: true }).click();
  await expect(page.getByLabel("Новий пароль", { exact: true })).toBeHidden();
  release();
  const alert = page.getByRole("alert").filter({ hasText: "Пароль не відповідає вимогам" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Новий пароль", { exact: true })).toBeVisible();
});

test("an advanced alarm filter remains apparent and can be cleared while collapsed", async ({ page }) => {
  const filters: string[] = [];
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/alarms?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    filters.push(new URL(route.request().url()).searchParams.get("alarm_type") ?? "");
    await fulfillJson(route, 200, [alarmFixture()]);
  });
  await page.goto(`/alarms/devices/${DEVICE_ID}`);
  await expect(page.getByLabel("Тип аварії", { exact: true })).toBeHidden();
  await (await alarmTypeFilter(page)).fill("custom.sensor.low");
  await page.getByRole("button", { name: "Застосувати тип", exact: true }).click();
  await page.getByText("Додаткові фільтри", { exact: true }).click();
  await expect(page.locator(".active-filter")).toContainText("custom.sensor.low");
  await page.getByRole("button", { name: "Скинути тип", exact: true }).click();
  await expect(page.locator(".active-filter")).toHaveCount(0);
  await expect.poll(() => filters.at(-1)).toBe("");
});
