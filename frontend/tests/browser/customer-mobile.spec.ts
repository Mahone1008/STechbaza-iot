import { refreshButton } from "../helpers/customer-details";
import { expect, test } from "@playwright/test";
import { controlOverview } from "../fixtures/commands";
import {
  API_ORIGIN,
  DEVICE_ID,
  ORGANIZATION_ID,
  SITE_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  mockMissingBrowserSession,
} from "./auth-fixtures";

const devicePath = `/devices/${DEVICE_ID}`;
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, controlOverview());
  });
});

for (const width of [320, 390]) {
  test(`password visibility control stays inside its field at ${width}px`, async ({ page }) => {
    await mockMissingBrowserSession(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    const password = page.getByLabel("Пароль", { exact: true });
    await password.fill("example-only-password");
    const toggle = page.getByRole("button", { name: "Показати пароль", exact: true });
    const inputBox = (await password.boundingBox())!;
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.width).toBeGreaterThanOrEqual(44);
    expect(toggleBox.height).toBeGreaterThanOrEqual(44);
    expect(toggleBox.x).toBeGreaterThan(inputBox.x);
    expect(toggleBox.x + toggleBox.width).toBeLessThan(inputBox.x + inputBox.width);
    expect(toggleBox.y).toBeGreaterThan(inputBox.y);
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height);
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("example-only-password");
    await page.getByRole("button", { name: "Приховати пароль", exact: true }).click();
    await expect(password).toHaveAttribute("type", "password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("technical readings are collapsed while the reason blocking operation stays visible", async ({ page }) => {
  const data = controlOverview();
  const id = "c41c4b87-b82d-4e35-8faa-000000000006";
  const now = new Date().toISOString();
  data.capabilities.push({
    id,
    code: "vfd.diagnostics.read",
    name: "vfd.diagnostics.read",
    description: null,
    created_at: now,
    updated_at: now,
  });
  const keys = ["control_armed", "vfd_configuration_valid", "vfd_link"];
  data.modules.push({
    assignment_id: "a41c4b87-b82d-4e35-8faa-000000000006",
    capability_id: id,
    code: "vfd.diagnostics.read",
    supported: true,
    channels: keys.map((key) => ({ key, source: "state", data_type: "boolean", unit: null, supports_series: false })),
    command_types: [],
    allowed_commands: [],
  });
  data.state_keys.push(...keys);
  data.state_readings.push(...keys.map((key) => ({ key, status: "fresh" as const, value: key !== "control_armed" })));
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, data);
  });
  await page.goto(devicePath);
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  await expect(page.getByText(/Контролер ще не дозволив керування/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "vfd.diagnostics.read", exact: true })).toHaveCount(0);
  const reading = page.locator(".metric-card").filter({ hasText: "Дозвіл керування" });
  await expect(reading).not.toBeVisible();
  await page.getByText("Додаткові показники контролера", { exact: true }).click();
  await expect(reading).toBeVisible();
  await expect(reading.locator("strong")).toHaveText("Ні");
});

for (const width of [320, 360, 390, 430, 768, 1440]) {
  test(`customer controls and all sections remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(devicePath);
    await expect(page.getByRole("heading", { name: "Обладнання зупинено", exact: true })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Розділи пристрою" });
    const geometry = await tabs.getByRole("tab").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { height: box.height, left: box.left, right: box.right, viewport: innerWidth };
      }),
    );
    expect(geometry).toHaveLength(5);
    for (const box of geometry) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.viewport);
    }
    const frequency = page.getByLabel("Задана частота, Гц", { exact: true });
    await frequency.fill("45");
    await expect(page.getByRole("button", { name: "Задати частоту", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: "Панель", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Обладнання", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(frequency).toHaveValue("45");
    const stop = page.getByRole("button", { name: "Зупинити", exact: true });
    expect((await stop.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await stop.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(stop).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goto(`/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}/devices`);
    await expect(page.getByRole("link", { name: "Насосна станція №1", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("a stale or disconnected reading never claims a current running state", async ({ page }) => {
  let data = controlOverview();
  data.state_readings[0]!.value = true;
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, data);
  });
  await page.goto(devicePath);
  await expect(page.getByRole("heading", { name: "Обладнання працює", exact: true })).toBeVisible();
  data = { ...data, availability: { ...data.availability, online: false, seconds_since_seen: 120 } };
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByRole("heading", { name: "Стан обладнання не підтверджено", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  data = { ...data, availability: { ...data.availability, online: true, seconds_since_seen: 0 } };
  data.telemetry_freshness.status = "stale";
  data.telemetry_freshness.reason = "timeout";
  for (const reading of [...data.readings, ...data.state_readings]) reading.status = "stale";
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByText(/Перевищено час актуальності/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Обладнання працює", exact: true })).toHaveCount(0);
});

test("connection details stay open across a refresh and a current fault is prominent", async ({ page }) => {
  let data = controlOverview();
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, data);
  });
  await page.goto(devicePath);
  const details = page.locator(".device-connection-details");
  await expect(details).not.toHaveAttribute("open");
  await details.getByText("Докладніше про зв’язок", { exact: true }).click();
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(details).toHaveAttribute("open", "");
  data = controlOverview();
  data.state_readings[1]!.value = 7;
  await (await refreshButton(page, "Оновити панель")).click();
  await expect(page.getByRole("heading", { name: "Помилка обладнання", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Код: 7" })).toBeVisible();
});
