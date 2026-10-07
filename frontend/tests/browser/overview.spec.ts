import { refreshButton, displaySettings } from "../helpers/customer-details";
import { expect, test, type Page } from "@playwright/test";
import { diagnosticsFixture, overviewFixture } from "../fixtures/overview";
import { API_ORIGIN, DEVICE_ID, ORGANIZATION_ID, SITE_ID, REFRESH_URL, devicePayload, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, mockBrowserLogoutSuccess } from "./auth-fixtures";
test.describe.configure({ retries: 0 });
const url = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`;
const path = `/devices/${DEVICE_ID}`;
async function mockOverview(page: Page, get: () => unknown, status = 200) {
  await page.route(url, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, status, get()); });
}
const fixture = () => overviewFixture(devicePayload());
test.beforeEach(async ({ page }) => mockAuthenticatedWorkspace(page));

test("diagnostics distinguish a requested stop from readback and transport-specific signals", async ({ page }) => {
  const data = fixture(); data.diagnostics = diagnosticsFixture();
  await mockOverview(page, () => data);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await page.getByText("Технічні дані контролера", { exact: true }).click();
  await expect(page.getByText("RSSI: -67 dBm", { exact: true })).toBeVisible();
  await expect(page.getByText("Просідання живлення", { exact: true })).toBeVisible();
  await expect(page.getByText("1 д 1 год 1 хв 1 с", { exact: true })).toBeVisible();
  await expect(page.getByText("Зупинку ще не підтверджено", { exact: true })).toBeVisible();
  await expect(page.getByText("Точний час події невідомий")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  data.diagnostics.connection = { transport: "cellular", signal: { metric: "rsrp", dbm: -105 } };
  data.diagnostics.last_stop!.confirmed = true;
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByText("RSRP: -105 dBm", { exact: true })).toBeVisible();
  await expect(page.getByText("STOP і 0 Гц підтверджено читанням частотника", { exact: true })).toBeVisible();
  await expect(page.getByText("RSSI: -67 dBm", { exact: true })).toHaveCount(0);
  data.diagnostics = null;
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByText("Розширена діагностика ще не надходила від контролера.")).toBeVisible();
  await expect(page.getByText("RSRP: -105 dBm", { exact: true })).toHaveCount(0);
});

test("diagnostics from an earlier boot are explicitly historical", async ({ page }) => {
  const data = fixture(); data.diagnostics = diagnosticsFixture();
  data.telemetry_freshness.status = "stale"; data.telemetry_freshness.reason = "session_changed";
  for (const item of [...data.readings, ...data.state_readings]) item.status = "stale";
  await mockOverview(page, () => data); await page.goto(path);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await page.getByText("Технічні дані контролера", { exact: true }).click();
  await expect(page.getByText("Діагностика попереднього запуску контролера; очікуємо нові дані.")).toBeVisible();
});

test("assigned numeric/state widgets preserve zero and false, with unsupported and command-only fallbacks", async ({ page }) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Показники обладнання", exact: true })).toBeVisible();
  const pressure = page.locator(".metric-card").filter({ hasText: "Тиск" });
  await expect(pressure.locator("strong")).toHaveText("0"); await expect(pressure).toContainText("bar");
  await expect(page.locator(".metric-card").filter({ hasText: "Стан роботи частотника" }).locator("strong")).toHaveText("Зупинено");
  await expect(page.locator(".metric-card").filter({ hasText: "Код помилки" }).locator("strong")).toHaveText("0");
  await expect(page.getByText("Цей модуль ще не підтримує відображення даних.")).toHaveCount(0);
  await expect(page.getByText(/Модуль керування без вимірювальних каналів/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Запустити|Зупинити/ })).toHaveCount(0);
});

test("online and stale telemetry remain separate; missing and invalid never become zero", async ({ page }) => {
  const data = fixture(); data.telemetry_freshness.status = "stale"; data.telemetry_freshness.reason = "session_changed";
  data.readings[0] = { ...data.readings[0]!, value: 2.5, status: "stale" };
  data.state_readings[0] = { ...data.state_readings[0]!, value: null, status: "missing" };
  data.state_readings[1] = { ...data.state_readings[1]!, value: null, status: "invalid" };
  await mockOverview(page, () => data); await page.goto(path);
  await expect(page.getByText("На зв’язку", { exact: true })).toBeVisible();
  await expect(page.getByText(/Очікуємо дані після перезапуску контролера/)).toBeVisible();
  await expect(page.locator(".metric-card").filter({ hasText: "Тиск" })).toContainText("Останнє значення. Поточний стан невідомий.");
  await expect(page.locator(".metric-card").filter({ hasText: "Стан роботи частотника" }).locator("strong")).toHaveText("-");
  await expect(page.locator(".metric-card").filter({ hasText: "Код помилки" })).toContainText("Некоректні дані");
});

test("refresh applies disable and enable atomically without reviving hidden snapshot values", async ({ page }) => {
  let data = fixture(); await mockOverview(page, () => data); await page.goto(path);
  await expect(page.locator(".metric-card").filter({ hasText: "Тиск" })).toBeVisible();
  data = { ...data, capabilities: [], modules: [], readings: [], state_readings: [], command_types: [], allowed_commands: [] };
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByText("Для пристрою немає увімкнених модулів.")).toBeVisible();
  await expect(page.locator(".metric-card")).toHaveCount(0);
  data = fixture(); data.readings[0]!.value = 8.25;
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.locator(".metric-card").filter({ hasText: "Тиск" }).locator("strong")).toHaveText("8,25");
});
for (const status of [403, 404, 503]) test(`overview ${status} on refresh hides prior readings and allows explicit recovery`, async ({ page }) => {
  await page.goto(path); await expect(page.locator(".metric-card")).toHaveCount(3);
  await mockOverview(page, () => ({ detail: "Unavailable" }), status);
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByRole("alert").filter({ has: page.getByRole("heading", { name: /Дані більше недоступні|Не вдалося завантажити панель/ }) })).toBeVisible(); await expect(page.locator(".metric-card")).toHaveCount(0);
  await mockOverview(page, fixture); await page.getByRole("button", { name: "Повторити", exact: true }).click();
  await expect(page.locator(".metric-card")).toHaveCount(3);
});

test("quality expires while idle without a background overview request", async ({ page }) => {
  let requests = 0; const data = fixture(); data.telemetry_freshness.stale_after_seconds = 2;
  await mockOverview(page, () => { requests += 1; return data; }); await page.goto(path);
  await (await displaySettings(page)).selectOption("0");
  await expect(page.getByText("Перевищено час актуальності")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".metric-card").filter({ hasText: "Тиск" })).toContainText("Застарілі дані");
  expect(requests).toBe(1);
});

test("late overview is aborted across navigation and cannot repopulate the directory", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let started = false;
  await page.route(url, async (route) => { if (await fulfillPreflight(route)) return; started = true; await gate; await fulfillJson(route, 200, fixture()).catch(() => {}); });
  try {
    await page.goto(path); await expect.poll(() => started).toBe(true);
    await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible();
    release(); await expect(page.locator(".metric-card")).toHaveCount(0);
  } finally { release(); }
});

test("viewer sees read-only modules on mobile without horizontal overflow", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer" }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(path);
  await expect(page.getByRole("heading", { name: "Показники обладнання", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Запустити|Зупинити/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("revoked browser session removes the module panel", async ({ page }) => {
  await page.goto(path); await expect(page.locator(".metric-card")).toHaveCount(3);
  await mockOverview(page, () => ({ detail: "Expired" }), 401);
  await page.route(REFRESH_URL, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 401, { detail: "Expired" }); });
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.locator(".metric-card")).toHaveCount(0);
});

test("logout clears module readings and saved context", async ({ page }) => {
  await mockBrowserLogoutSuccess(page); await page.goto(path); await expect(page.locator(".metric-card")).toHaveCount(3);
  await page.locator(".sidebar").getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/ }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/); await expect(page.locator(".metric-card")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("foreign overview identity is rejected instead of rendering another device", async ({ page }) => {
  const data = fixture(); data.device.site_id = ORGANIZATION_ID;
  await mockOverview(page, () => data); await page.goto(`/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}/devices`);
  await page.getByRole("link", { name: "Насосна станція №1" }).click();
  await expect(page.getByRole("alert").filter({ has: page.getByRole("heading", { name: /Дані більше недоступні|Не вдалося завантажити панель/ }) })).toBeVisible(); await expect(page.locator(".metric-card")).toHaveCount(0);
});

test("equipment diagnostics age in manual mode and disappear after a failed refresh", async ({ page }) => {
  const data = fixture(); data.diagnostics = diagnosticsFixture();
  await mockOverview(page, () => data);
  await page.clock.install();
  await page.goto(path);
  await (await displaySettings(page)).selectOption("0");
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await page.getByText("Технічні дані контролера", { exact: true }).click();
  const diagnostics = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Діагностика контролера", exact: true }) });
  await expect(diagnostics).toContainText("Свіжі дані");
  await page.clock.fastForward(130_000);
  await expect(diagnostics).toContainText("Остання відома діагностика; поточний стан не підтверджено.");
  await mockOverview(page, () => ({ detail: "Unavailable" }), 503);
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByRole("heading", { name: "Діагностика контролера", exact: true })).toHaveCount(0);
});
