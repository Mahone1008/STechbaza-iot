import { checkNotificationIncident } from "../helpers/notification-incident";
import type { components } from "../../src/lib/api/schema";
import { expect, test } from "@playwright/test";

const API = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const email = process.env.KERUMO_DEMO_EMAIL;
const password = process.env.KERUMO_DEMO_PASSWORD;
if (!email || !password) throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required.");
const org = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
const site = "9e3a3976-5a1a-542d-a9cf-293cce615a2c";
const otherOrg = "5806e9f8-fe25-54ae-b325-7ef966557583";
const otherSite = "06f9b5e6-1ad4-529d-9aa1-7c64ec1dcd0c";
const otherDevice = "74bf39d6-2a73-58ff-8d98-23c40dc9e3bd";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toBeVisible();
});

test("real organization and site selection shows API devices, presence and restored deep links", async ({ page, browser }) => {
  test.setTimeout(process.env.KERUMO_RUN_NOTIFICATION_DEMO === "1" ? 180_000 : 60_000);
  await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "DEMO: клієнт A", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Об’єкти", exact: true })).toBeVisible();
  const listResponse = page.waitForResponse((response) => response.request().method() === "GET" && response.url().startsWith(`${API}/api/v1/sites/${site}/devices?`));
  await page.getByRole("link", { name: "DEMO: тестовий майданчик A", exact: true }).click();
  const response = await listResponse;
  expect(response.status()).toBe(200);
  const rows = await response.json() as { id: string; uid: string; name: string }[];
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    await expect(page.getByRole("link", { name: row.name, exact: true })).toHaveAttribute("href", `/devices/${row.id}`);
    await expect(page.getByText(row.uid, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Оновити зв’язок" })).toBeEnabled();
  await expect(page.getByText("Стан невідомий", { exact: true })).toHaveCount(0);
  await expect(page.getByText("TB-DEMO-OTHER", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Наступна" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Шлях до об’єкта" })).toContainText("DEMO: тестовий майданчик A");
  await page.goto("/devices");
  await expect(page.getByRole("navigation", { name: "Шлях до об’єкта" })).toContainText("DEMO: тестовий майданчик A");
  const overviewPromise = page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith("/overview"))
    .then(async (response) => { expect(response.status()).toBe(200); return await response.json() as components["schemas"]["DeviceOverviewRead"]; });
  await page.getByRole("link", { name: "DEMO: насос з частотником", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEMO: насос з частотником", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Модулі та канали" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeVisible();
  const overview = await overviewPromise;
  expect(overview.modules.length).toBeGreaterThan(0);
  for (const capability of overview.capabilities) {
    await expect(page.locator(".overview-modules .card-description").filter({ hasText: capability.code })).toBeVisible();
  }
  const channels = overview.modules.flatMap((module) => module.channels);
  await expect(page.locator(".metric-card")).toHaveCount(channels.length);
  await expect(page.getByText("TB-DEMO-PUMP", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Оновити панель" }).click();
  await expect(page.locator(".metric-card")).toHaveCount(channels.length);
  // Перевіряємо реальний series без додаткового login та навантаження rate limit.
  await expect(page.getByRole("button", { name: "Оновити історію" })).toBeEnabled();
  const historyPromise = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/telemetry/series?"))
    .then(async (response) => { expect(response.status()).toBe(200); return await response.json() as components["schemas"]["TelemetrySeriesRead"]; });
  await page.getByRole("button", { name: "Оновити історію" }).click();
  const history = await historyPromise;
  expect(history.device_id).toBe(overview.device.id);
  expect(history.time_basis).toBe("server_received_at");
  expect(history.buckets.length).toBe(60);
  await expect(page.getByRole("heading", { name: "Історія недоступна" })).toHaveCount(0);
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  await expect(page.locator(".history-table")).toContainText(history.unit);
  // Explicit opt-in; never send test commands to an arbitrary configured API/device.
  if (process.env.KERUMO_RUN_COMMAND_DEMO === "1") {
    expect(API).toBe("http://127.0.0.1:8001");
    expect(overview.device.uid).toBe("TB-DEMO-PUMP");
    const control = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Керування пристроєм", exact: true }) });
    await control.getByRole("button", { name: "Зупинити", exact: true }).click();
    const receiptPromise = page.waitForResponse((r) => r.request().method() === "POST" && r.url() === `${API}/api/v1/devices/${overview.device.id}/commands`);
    await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click();
    const receipt = await receiptPromise; expect(receipt.status()).toBe(201);
    const command = await receipt.json() as components["schemas"]["DeviceCommandRead"];
    expect(command.command_type).toBe("vfd.stop"); expect(command.device_id).toBe(overview.device.id);
    const details = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Стан вибраної команди", exact: true }) });
    await expect(details.locator(".status-badge")).toHaveText("Контролер повідомив про виконання", { timeout: 20_000 });
    await details.getByText("Автор і технічні деталі команди", { exact: true }).click();
    await expect(details).toContainText(command.request_id); await expect(details).toContainText(email);
    await page.getByRole("button", { name: "Оновити журнал", exact: true }).click();
    await expect(page.getByRole("table", { name: "Журнал команд пристрою" })).toContainText("Контролер повідомив про виконання");
  }
  // Лише явно підготовлений demo incident; не підтверджуємо реальні аварії.
  if (process.env.KERUMO_RUN_ALARM_DEMO === "1") {
    expect(API).toBe("http://127.0.0.1:8001");
    const pressure = rows.find((row) => row.uid === "TB-DEMO-PRESSURE")!;
    expect(pressure).toBeDefined();
    await page.goto(`/alarms/devices/${pressure.id}`);
    await page.getByLabel("Тип аварії", { exact: true }).fill("demo.frontend.acknowledgement");
    await page.getByRole("button", { name: "Застосувати тип" }).click();
    const incidentPromise = page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/v1\/alarms\/[0-9a-f-]+$/u.test(new URL(r.url()).pathname))
      .then(async (r) => { expect(r.status()).toBe(200); return await r.json() as components["schemas"]["DeviceAlarmRead"]; });
    await page.getByRole("link", { name: "DEMO: acknowledgement check", exact: true }).click();
    const incident = await incidentPromise;
    expect(incident.device_id).toBe(pressure.id); expect(incident.alarm_type).toBe("demo.frontend.acknowledgement"); expect(incident.acknowledged_at).toBeNull();
    const incidentCard = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Стан інциденту", exact: true }) });
    await incidentCard.getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    const ackPromise = page.waitForResponse((r) => r.request().method() === "POST" && r.url() === `${API}/api/v1/alarms/${incident.id}/acknowledge`)
      .then(async (r) => { expect(r.status()).toBe(200); return await r.json() as components["schemas"]["DeviceAlarmRead"]; });
    await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
    const acknowledged = await ackPromise;
    expect(acknowledged.acknowledged_at).not.toBeNull(); expect(acknowledged.state).toBe("active"); expect(acknowledged.acknowledged_by_email).toBe(email);
    await expect(incidentCard).toContainText(email);
    await expect(page.getByRole("table", { name: "Переходи інциденту" })).toContainText("Підтверджена оператором");
    await page.reload(); await expect(incidentCard).toContainText(email);
    await expect(incidentCard.getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
  }
  if (process.env.KERUMO_RUN_NOTIFICATION_DEMO === "1") await checkNotificationIncident(page, browser);
  // Same authenticated test also exercises a different modular composition.
  const newDevice = rows.find((row) => row.uid === "TB-DEMO-NEW")!;
  await page.goto(`/devices/${newDevice.id}`);
  await expect(page.getByRole("heading", { name: newDevice.name, exact: true })).toBeVisible();
  await expect(page.locator(".overview-modules .card-description")).toHaveText(["water_level.read"]);
  await expect(page.locator(".metric-card")).toHaveCount(1);
  await expect(page.locator(".metric-card")).toContainText("Немає даних");
  await expect(page.locator(".metric-card strong")).toHaveText("—");
  await expect(page.getByText("TB-DEMO-PUMP", { exact: true })).toHaveCount(0);

});

test("real backend denies foreign organization, site and device deep links", async ({ page }) => {
  for (const path of [`/organizations/${otherOrg}/notifications`, `/organizations/${otherOrg}/sites`, `/organizations/${org}/sites/${otherSite}/devices`, `/devices/${otherDevice}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Немає доступної організації" })).toBeVisible();
    await expect(page.getByText("TB-DEMO-OTHER", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Обрати організацію" }).click();
  await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible();
});
