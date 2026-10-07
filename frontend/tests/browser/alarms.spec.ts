import { refreshButton, alarmTypeFilter } from "../helpers/customer-details";
import { expect, test, type Page, type Route } from "@playwright/test";
import { acknowledgedFixture, alarmFixture, alarmId, transitionFixture } from "../fixtures/alarms";
import type { Alarm } from "../../src/lib/api/alarms";
import { API_ORIGIN, DEVICE_ID, ORGANIZATION_ID, DEVICES_URL, USER_ID, corsHeaders, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, viewerPermissions } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const listPath = `/alarms/devices/${DEVICE_ID}`;
const path = `${listPath}/${alarmId}`;
const listUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/alarms`;
const detailUrl = `${API_ORIGIN}/api/v1/alarms/${alarmId}`;
const table = (page: Page) => page.getByRole("table", { name: "Аварії вибраного пристрою" });
const detail = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Стан інциденту", exact: true }) });
async function mockGet(page: Page, url: string, get: () => unknown) { await page.route(url, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, get()); }); }
async function mockPost(page: Page, handler: (route: Route) => Promise<void>) { await page.route(`${detailUrl}/acknowledge`, async (route) => { if (await fulfillPreflight(route)) return; expect(route.request().method()).toBe("POST"); await handler(route); }); }
async function confirm(page: Page) { await detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).click(); }
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await mockGet(page, `${listUrl}?*`, () => [alarmFixture()]);
  await mockGet(page, detailUrl, alarmFixture);
  await mockGet(page, `${detailUrl}/transitions?*`, () => [transitionFixture()]);
});

test("alarm directory reads one bounded device page without alarm fan-out", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() === "GET" && request.url().startsWith(API_ORIGIN)) requests.push(request.url()); });
  await page.goto("/alarms");
  const devices = page.getByRole("table", { name: "Пристрої для перегляду аварій" });
  await expect(devices).toContainText("Насосна станція №1");
  expect(requests.filter((url) => url.includes("/alarms"))).toHaveLength(0);
  const catalog = requests.filter((url) => url.startsWith(DEVICES_URL)); expect(catalog).toHaveLength(1);
  expect(new URL(catalog[0]!).searchParams.get("limit")).toBe("21");
  await devices.getByRole("link", { name: "Насосна станція №1" }).click();
  await expect(table(page)).toContainText("Низький тиск");
});

test("state, severity and exact type filters go to the API and reset pagination", async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await page.route(`${listUrl}?*`, async (route) => {
    if (await fulfillPreflight(route)) return; const q = new URL(route.request().url()).searchParams; queries.push(q);
    await fulfillJson(route, 200, [alarmFixture({ state: q.get("state") === "resolved" ? "resolved" : "active", resolved_at: q.get("state") === "resolved" ? "2026-09-28T12:01:00Z" : null, severity: q.get("severity") === "critical" ? "critical" : "warning", alarm_type: q.get("alarm_type") ?? "demo.pressure.low" })]);
  });
  await page.goto(listPath); await expect(table(page)).toContainText("Активна");
  await page.getByLabel("Стан аварії", { exact: true }).selectOption("resolved"); await expect(table(page)).toContainText("Усунена");
  await page.getByLabel("Важливість", { exact: true }).selectOption("critical"); await expect(table(page)).toContainText("Критична");
  const before = queries.length;
  await (await alarmTypeFilter(page)).fill("custom.sensor.low"); expect(queries).toHaveLength(before);
  await page.getByRole("button", { name: "Застосувати тип" }).click(); await expect(table(page)).toContainText("custom.sensor.low");
  expect(Object.fromEntries(queries.at(-1)!)).toEqual({ limit: "21", offset: "0", state: "resolved", severity: "critical", alarm_type: "custom.sensor.low" });
});

test("list has bounded previous/next pages and refresh returns to page one", async ({ page }) => {
  const rows = Array.from({ length: 23 }, (_, i) => alarmFixture({ id: `e8f2f2d6-e380-492a-a9dc-${String(i).padStart(12, "0")}`, title: `Інцидент ${i}` }));
  await page.route(`${listUrl}?*`, async (route) => { if (await fulfillPreflight(route)) return; const offset = Number(new URL(route.request().url()).searchParams.get("offset")); await fulfillJson(route, 200, rows.slice(offset, offset + 21)); });
  await page.goto(listPath); await expect(table(page)).toContainText("Інцидент 19"); await expect(table(page).getByRole("link", { name: "Інцидент 20", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Наступна сторінка" }).click(); await expect(table(page)).toContainText("Інцидент 20");
  await expect(page.getByRole("button", { name: "Наступна сторінка" })).toBeDisabled();
  await (await refreshButton(page, "Оновити аварії")).click(); await expect(table(page)).toContainText("Інцидент 0");
  await expect(page.getByRole("button", { name: "Попередня сторінка" })).toBeDisabled();
});

for (const status of [403, 404, 503]) test(`list ${status} hides previous data and recovers only after explicit refresh`, async ({ page }) => {
  let error = false, calls = 0;
  await page.route(`${listUrl}?*`, async (route) => { if (await fulfillPreflight(route)) return; calls++; await fulfillJson(route, error ? status : 200, error ? { detail: `Alarm error ${status}` } : [alarmFixture()]); });
  await page.goto(listPath); await expect(table(page)).toContainText("Низький тиск"); error = true;
  await (await refreshButton(page, "Оновити аварії")).click(); await expect(page.getByRole("alert").filter({ has: page.getByRole("heading", { name: /Аварії недоступні|Не вдалося завантажити аварії/ }) })).toContainText(status === 403 ? "Недостатньо прав" : status === 404 ? "Дані не знайдено" : "Сервіс тимчасово недоступний"); await expect(table(page)).toHaveCount(0);
  expect(calls).toBe(2); error = false; await (await refreshButton(page, "Оновити аварії")).click(); await expect(table(page)).toContainText("Низький тиск"); expect(calls).toBe(3);
});

test("empty and foreign-device results are not substituted by demo incidents", async ({ page }) => {
  let rows: Alarm[] = []; await mockGet(page, `${listUrl}?*`, () => rows);
  await page.goto(listPath); await expect(page.getByText("За вибраними фільтрами аварій немає.")).toBeVisible();
  rows = [alarmFixture({ device_id: ORGANIZATION_ID, title: "Foreign incident" })];
  await (await refreshButton(page, "Оновити аварії")).click(); await expect(page.getByRole("heading", { name: "Не вдалося завантажити аварії" })).toBeVisible();
  await expect(page.getByText("Foreign incident")).toHaveCount(0);
});

test("detail verifies alarm ownership before requesting transition history", async ({ page }) => {
  let transitions = 0; await mockGet(page, detailUrl, () => alarmFixture({ device_id: ORGANIZATION_ID, title: "Foreign detail" }));
  await mockGet(page, `${detailUrl}/transitions?*`, () => { transitions++; return []; });
  await page.goto(path); await expect(detail(page).getByRole("heading", { name: "Не вдалося завантажити аварії" })).toBeVisible();
  await expect(page.getByText("Foreign detail")).toHaveCount(0); expect(transitions).toBe(0);
});

test("transition history is bounded and validates parent identity on every page", async ({ page }) => {
  const rows = Array.from({ length: 23 }, (_, i) => transitionFixture({ id: `f8f2f2d6-e380-492a-a9dc-${String(i).padStart(12, "0")}`, reason: `reason-${i}`, transition_type: "repeated", from_state: "active" }));
  let foreign = false;
  await page.route(`${detailUrl}/transitions?*`, async (route) => { if (await fulfillPreflight(route)) return; const q = new URL(route.request().url()).searchParams; expect(q.get("limit")).toBe("21"); const offset = Number(q.get("offset")); await fulfillJson(route, 200, foreign ? [transitionFixture({ alarm_id: ORGANIZATION_ID, reason: "foreign-transition" })] : rows.slice(offset, offset + 21)); });
  await page.goto(path); const history = page.getByRole("table", { name: "Переходи інциденту" }); await expect(history).toContainText("reason-19");
  await page.getByRole("button", { name: "Наступна сторінка" }).click(); await expect(history).toContainText("reason-20"); await expect(history).not.toContainText("reason-19");
  foreign = true; await page.getByRole("button", { name: "Оновити історію інциденту" }).click(); await expect(history).toHaveCount(0); await expect(page.getByText("foreign-transition")).toHaveCount(0);
});

test("confirmation cancel and double click create one acknowledgement while incident stays active", async ({ page }) => {
  let row = alarmFixture(), posts = 0; await mockGet(page, detailUrl, () => row);
  await mockPost(page, async (route) => { posts++; row = acknowledgedFixture(); await fulfillJson(route, 200, row); });
  await page.goto(path); await detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Аварія залишиться активною"); await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click(); expect(posts).toBe(0);
  await detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(detail(page)).toContainText("Оператор тесту"); await expect(detail(page).locator(".status-badge")).toContainText(["Попередження", "Активна", "Підтверджена оператором"]); expect(posts).toBe(1);
  await page.reload(); await expect(detail(page)).toContainText("Оператор тесту"); expect(posts).toBe(1);
});

test("idempotent response preserves the first concurrent operator instead of inventing current actor", async ({ page }) => {
  let row = alarmFixture(); await mockGet(page, detailUrl, () => row);
  await mockPost(page, async (route) => { row = acknowledgedFixture({ acknowledged_by_user_id: alarmId, acknowledged_by_display_name: "Перший оператор", acknowledged_by_email: "first@example.com" }); await fulfillJson(route, 200, row); });
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("Перший оператор"); await expect(detail(page)).not.toContainText("owner@example.com");
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
});

test("concurrent resolution returns 409, reloads server state and cannot falsely acknowledge", async ({ page }) => {
  let row = alarmFixture(), posts = 0; await mockGet(page, detailUrl, () => row);
  await mockPost(page, async (route) => { posts++; row = alarmFixture({ state: "resolved", resolved_at: "2026-09-28T12:01:00Z" }); await fulfillJson(route, 409, { detail: "Resolved concurrently" }); });
  await page.goto(path); await confirm(page); await expect(detail(page).locator(".status-badge")).toContainText(["Попередження", "Усунена", "Без підтвердження"]); expect(posts).toBe(1);
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
});

for (const saved of [true, false]) test(`lost acknowledgement response requires GET reconciliation, saved=${saved}`, async ({ page }) => {
  let row = alarmFixture(), posts = 0; await mockGet(page, detailUrl, () => row);
  await mockPost(page, async (route) => { posts++; if (posts === 1) { if (saved) { row = acknowledgedFixture(); await route.abort("failed"); } else await fulfillJson(route, 503, { detail: "Temporary outage" }); } else { row = acknowledgedFixture(); await fulfillJson(route, 200, row); } });
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("Результат підтвердження невідомий");
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeDisabled(); expect(posts).toBe(1);
  await detail(page).getByRole("button", { name: "Перевірити стан" }).click();
  if (saved) { await expect(detail(page)).toContainText("Оператор тесту"); expect(posts).toBe(1); }
  else { await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeEnabled(); await confirm(page); await expect(detail(page)).toContainText("Оператор тесту"); expect(posts).toBe(2); }
});

test("429 acknowledgement honors Retry-After even after GET, with no automatic POST", async ({ page }) => {
  await page.clock.install(); let posts = 0;
  await mockPost(page, async (route) => { posts++; await route.fulfill({ status: 429, headers: { ...corsHeaders, "content-type": "application/json", "Retry-After": "10" }, body: JSON.stringify({ detail: "Slow down" }) }); });
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("Результат підтвердження невідомий");
  await detail(page).getByRole("button", { name: "Перевірити стан" }).click();
  // Fast-forward лише після завершення GET: інакше годинник спрацьовує на його timeout.
  await expect(detail(page)).toContainText("Стан перевірено: підтвердження ще не зафіксоване.");
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeDisabled();
  await page.clock.fastForward(11_000); await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeEnabled(); expect(posts).toBe(1);
});

for (const status of [401, 403, 404]) test(`POST ${status} hides incident and history with no write replay`, async ({ page }) => {
  let posts = 0; await mockPost(page, async (route) => { posts++; await fulfillJson(route, status, { detail: `Ack denied ${status}` }); });
  await page.goto(path); await confirm(page); await expect(detail(page).getByRole("heading", { name: "Аварії недоступні" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Низький тиск", exact: true })).toHaveCount(0); await expect(page.getByRole("table", { name: "Переходи інциденту" })).toHaveCount(0); expect(posts).toBe(1);
});

test("wrong acknowledgement receipt remains uncertain and never exposes foreign actor", async ({ page }) => {
  await mockPost(page, async (route) => fulfillJson(route, 200, acknowledgedFixture({ id: USER_ID, acknowledged_by_display_name: "Foreign actor" })));
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("Результат підтвердження невідомий"); await expect(page.getByText("Foreign actor")).toHaveCount(0);
});

test("revoked transition access hides the incident snapshot and requires access revalidation", async ({ page }) => {
  await page.goto(path); await expect(page.getByRole("table", { name: "Переходи інциденту" })).toBeVisible();
  await page.route(`${detailUrl}/transitions?*`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 403, { detail: "Access revoked" }); });
  await page.getByRole("button", { name: "Оновити історію інциденту" }).click();
  await expect(detail(page).getByRole("heading", { name: "Аварії недоступні" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Низький тиск", exact: true })).toHaveCount(0); await expect(page.getByRole("table", { name: "Переходи інциденту" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Оновити доступ" })).toBeVisible();
});

test("viewer mobile detail escapes content and has no acknowledgement control", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer" }); await page.setViewportSize({ width: 390, height: 844 });
  await mockGet(page, detailUrl, () => alarmFixture({ title: '<img src=x onerror="alert(1)">', description: "<script>alert(1)</script>", context: { text: "x".repeat(300) } }));
  await page.goto(path); await expect(detail(page)).toContainText('<img src=x onerror="alert(1)">'); await expect(detail(page).locator("img, script")).toHaveCount(0);
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
  await page.getByText("Додаткові відомості", { exact: true }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("alarm permission blocks a deep link without fetching incident data", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { permissions: viewerPermissions.filter((value) => value !== "alarm.read") }); let reads = 0;
  await mockGet(page, detailUrl, () => { reads++; return alarmFixture(); });
  await page.goto(path); await expect(page.getByRole("heading", { name: "Недостатньо прав" })).toBeVisible(); expect(reads).toBe(0);
});

test("offline confirmation and reconnection never submit an old acknowledgement", async ({ page, context }) => {
  let posts = 0; await mockPost(page, async (route) => { posts++; await route.abort(); });
  await page.goto(path); await detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true }).click(); await context.setOffline(true);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click(); await context.setOffline(false); await page.reload();
  await expect(detail(page).getByRole("button", { name: "Підтвердити отримання", exact: true })).toBeEnabled(); expect(posts).toBe(0);
});

test("navigation aborts pending acknowledgement and late response cannot restore an incident", async ({ page }) => {
  let release!: () => void, started = false; const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockPost(page, async (route) => { started = true; await gate; await fulfillJson(route, 200, acknowledgedFixture()).catch(() => {}); });
  try {
    await page.goto(path); await confirm(page); await expect.poll(() => started).toBe(true);
    await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible(); release(); await expect(detail(page)).toHaveCount(0);
  } finally { release(); }
});
