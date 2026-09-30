import { expect, test, type Page, type Route } from "@playwright/test";
import { commandFixture, commandId, controlOverview } from "../fixtures/commands";
import type { Command, CommandInput } from "../../src/lib/api/commands";
import { API_ORIGIN, DEVICE_ID, ORGANIZATION_ID, corsHeaders, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const path = `/devices/${DEVICE_ID}`;
const overviewUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/overview`;
const commandsUrl = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/commands`;
const detailUrl = `${API_ORIGIN}/api/v1/commands/${commandId}`;
const controls = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Керування пристроєм", exact: true }) });
const detail = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Стан вибраної команди", exact: true }) });
async function mockOverview(page: Page, get = controlOverview) { await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, get()); }); }
async function mockPost(page: Page, handler: (route: Route, body: CommandInput) => Promise<void>) { await page.route(commandsUrl, async (route) => { if (await fulfillPreflight(route)) return; expect(route.request().method()).toBe("POST"); await handler(route, route.request().postDataJSON() as CommandInput); }); }
async function confirm(page: Page, label = "Запустити") { await controls(page).getByRole("button", { name: label, exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click(); }
async function mockDetail(page: Page, get: () => Command = commandFixture) { await page.route(detailUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, get()); }); }
test.beforeEach(async ({ page }) => { await mockAuthenticatedWorkspace(page); await mockOverview(page); await mockDetail(page); });

test("default polling keeps a 15-second presence lease current and refreshes journal without hiding readings", async ({ page }) => {
  await page.clock.install(); let gets = 0; let records: Command[] = [];
  await mockOverview(page, () => { gets++; const data = controlOverview(); data.availability.timeout_seconds = 15; data.availability.seconds_since_seen = 0; return data; });
  await page.route(`${commandsUrl}?*`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, records); });
  await page.goto(path);
  await expect(page.getByLabel("Автооновлення", { exact: true })).toHaveValue("5");
  await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeEnabled();
  for (let i = 0; i < 4; i++) {
    const before = gets; await page.clock.fastForward(5100); await expect.poll(() => gets).toBeGreaterThan(before);
    await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeEnabled();
    await expect(page.getByText("Потрібно оновити зв’язок", { exact: true })).toHaveCount(0);
  }
  records = [commandFixture({ status: "succeeded" })]; await page.clock.fastForward(5100);
  const journal = page.getByRole("table", { name: "Журнал команд пристрою" });
  await expect(journal).toContainText("Контролер повідомив про виконання");
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
  records = []; const stopped = gets; await page.clock.fastForward(16000);
  expect(gets).toBe(stopped); await expect(journal).toBeVisible();
  await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(controls(page).getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
});

test("background overview refresh retains readings and does not disable Stop", async ({ page }) => {
  await page.goto(path); await expect(page.locator(".metric-card").first()).toBeVisible();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); let started = false;
  await page.route(overviewUrl, async (route) => { if (await fulfillPreflight(route)) return; started = true; await gate; await fulfillJson(route, 200, controlOverview()).catch(() => {}); });
  try {
    await page.getByRole("button", { name: "Оновити панель" }).click(); await expect.poll(() => started).toBe(true);
    await expect(page.locator(".metric-card").first()).toBeVisible();
    await expect(controls(page).getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  } finally { release(); }
});

test("frequency validation, cancel and confirmation send exactly one immutable request", async ({ page }) => {
  const posts: CommandInput[] = [];
  await mockPost(page, async (route, body) => { posts.push(body); await fulfillJson(route, 201, commandFixture(body)); });
  await page.goto(path);
  const button = controls(page).getByRole("button", { name: "Задати частоту", exact: true });
  await expect(button).toBeDisabled(); await page.getByLabel("Задана частота, Гц").fill("101"); await expect(button).toBeDisabled();
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByLabel("Час на прийняття команди, с").fill("4"); await page.getByLabel("Задана частота, Гц").fill("0"); await expect(button).toBeDisabled();
  await page.getByLabel("Час на прийняття команди, с").fill("30"); await button.click();
  await expect(page.getByRole("dialog")).toContainText("0 Гц"); await expect(page.getByRole("dialog")).toContainText("TB-TEST-0");
  expect(posts).toHaveLength(0); await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click(); expect(posts).toHaveLength(0);
  await button.click();
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(detail(page)).toContainText("У черзі"); expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ command_type: "vfd.frequency.set", payload: { frequency_hz: 0 }, ttl_seconds: 30 });
  expect(posts[0]!.request_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("lost response only retries manually with the same request_id and payload", async ({ page }) => {
  const posts: CommandInput[] = [];
  await mockPost(page, async (route, body) => { posts.push(body); if (posts.length === 1) await route.abort("failed"); else await fulfillJson(route, 200, commandFixture(body)); });
  await page.goto(path); await confirm(page);
  await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
  await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeDisabled(); expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Повторити той самий запит", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити повтор" }).click();
  await expect(detail(page)).toContainText("У черзі"); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  await page.reload(); await expect(controls(page)).toBeVisible(); expect(posts).toHaveLength(2);
});

test("request uncertainty expires without a replay after F5 or reconnect", async ({ page, context }) => {
  await page.clock.install(); let posts = 0;
  await mockPost(page, async (route) => { posts++; await route.abort("failed"); });
  await page.goto(path);
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByLabel("Час на прийняття команди, с").fill("5"); await confirm(page);
  await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(page.getByRole("button", { name: "Повторити той самий запит", exact: true })).toBeDisabled();
  await expect(page.getByText("Час ручного повтору минув. Перевірте журнал команд.")).toBeVisible();
  await context.setOffline(true); await context.setOffline(false); await page.reload();
  await expect(controls(page)).toBeVisible(); expect(posts).toBe(1);
});

test("POST 429 respects Retry-After and never retries automatically", async ({ page }) => {
  await page.clock.install(); let posts = 0;
  await mockPost(page, async (route) => { posts++; await route.fulfill({ status: 429, headers: { ...corsHeaders, "content-type": "application/json", "Retry-After": "10" }, body: JSON.stringify({ detail: "Slow down" }) }); });
  await page.goto(path); await confirm(page);
  const retry = page.getByRole("button", { name: "Повторити той самий запит", exact: true });
  await expect(retry).toBeDisabled(); await page.clock.fastForward(11_000); await expect(retry).toBeEnabled(); expect(posts).toBe(1);
});

for (const status of [401, 403, 409, 422]) test(`POST ${status} is shown without an automatic write retry`, async ({ page }) => {
  let posts = 0; await mockPost(page, async (route) => { posts++; await fulfillJson(route, status, { detail: `Command denied ${status}` }); });
  await page.goto(path); await confirm(page); await expect(controls(page)).toContainText(`Command denied ${status}`); expect(posts).toBe(1);
  await expect(page.getByRole("button", { name: "Повторити той самий запит", exact: true })).toHaveCount(0);
});

test("latest capability check cancels an already confirmed intent before POST", async ({ page }) => {
  let allowed = true, posts = 0;
  await mockOverview(page, () => { const data = controlOverview(); if (!allowed) { data.allowed_commands = []; data.modules[3]!.allowed_commands = []; } return data; });
  await mockPost(page, async (route) => { posts++; await route.abort(); });
  await page.goto(path); await controls(page).getByRole("button", { name: "Запустити", exact: true }).click(); allowed = false;
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click();
  await expect(controls(page)).toContainText("Команда більше недоступна"); expect(posts).toBe(0);
});

test("offline controller blocks Start/frequency but Stop has an explicit queued-delivery warning", async ({ page }) => {
  await mockOverview(page, () => { const data = controlOverview(); data.availability.online = false; data.availability.seconds_since_seen = 120; return data; });
  await page.goto(path); await page.getByLabel("Задана частота, Гц").fill("45");
  await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await expect(controls(page).getByRole("button", { name: "Задати частоту", exact: true })).toBeDisabled();
  await controls(page).getByRole("button", { name: "Зупинити", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("Фізичну зупинку ще не підтверджено");
});

test("foreign POST receipt stays uncertain and cannot expose command detail", async ({ page }) => {
  await mockPost(page, async (route, body) => fulfillJson(route, 201, commandFixture({ ...body, device_id: ORGANIZATION_ID })));
  await page.goto(path); await confirm(page); await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
});

test("navigation aborts a pending write and a late receipt cannot revive the device screen", async ({ page }) => {
  let release!: () => void, started = false; const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockPost(page, async (route, body) => { started = true; await gate; await fulfillJson(route, 201, commandFixture(body)).catch(() => {}); });
  try {
    await page.goto(path); await confirm(page); await expect.poll(() => started).toBe(true);
    await page.getByRole("navigation", { name: "Шлях до об’єкта" }).getByRole("link", { name: "Організації", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible(); release();
    await expect(detail(page)).toHaveCount(0); await expect(controls(page)).toHaveCount(0);
  } finally { release(); }
});

test("viewer has journal access without command controls, including mobile layout", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer" });
  await page.route(`${commandsUrl}?*`, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, [commandFixture()]); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(path);
  await expect(controls(page)).toHaveCount(0);
  await page.getByRole("table", { name: "Журнал команд пристрою" }).getByRole("link", { name: "Переглянути команду Запустити", exact: true }).click();
  await expect(detail(page)).toContainText("У черзі");
  await detail(page).getByText("Автор і технічні деталі команди", { exact: true }).click();
  await expect(detail(page)).toContainText("owner@example.com");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("selected lifecycle polls ACK separately from result, stops on unknown and accepts a late result manually", async ({ page }) => {
  await page.clock.install(); let gets = 0; let status = "queued";
  await mockPost(page, async (route, body) => fulfillJson(route, 201, commandFixture(body)));
  await mockDetail(page, () => { gets++; return commandFixture({ status, acknowledged_at: status === "queued" ? null : "2026-09-28T12:00:01Z", result_deadline_at: status === "queued" ? null : "2026-09-28T12:02:01Z" }); });
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("У черзі");
  status = "acknowledged"; await page.clock.fastForward(5100); await expect(detail(page).locator(".status-badge")).toHaveText("Контролер підтвердив прийом");
  status = "result_unknown"; await page.clock.fastForward(5100); await expect(detail(page).locator(".status-badge")).toHaveText("Результат невідомий");
  const stopped = gets; await page.clock.fastForward(11_000); expect(gets).toBe(stopped);
  status = "succeeded"; await detail(page).getByRole("button", { name: "Оновити стан команди" }).click();
  await expect(detail(page).locator(".status-badge")).toHaveText("Контролер повідомив про виконання");
});

test("cursor journal pages retain their boundary after insertion and reject foreign rows", async ({ page }) => {
  const rows = Array.from({ length: 23 }, (_, index) => commandFixture({ id: `b8f2f2d6-e380-492a-a9dc-${String(100 - index).padStart(12, "0")}`, actor_display_name: `Actor ${index}` }));
  const queries: URLSearchParams[] = []; let foreign = false;
  await page.route(`${commandsUrl}?*`, async (route) => {
    if (await fulfillPreflight(route)) return; const query = new URL(route.request().url()).searchParams; queries.push(query);
    const id = query.get("before_id"); const start = id ? rows.findIndex((row) => row.id === id) + 1 : 0;
    await fulfillJson(route, 200, foreign ? [commandFixture({ device_id: ORGANIZATION_ID })] : rows.slice(start, start + 21));
  });
  await page.goto(path); const table = page.getByRole("table", { name: "Журнал команд пристрою" }); await expect(table).toContainText("Actor 19");
  const boundary = rows[19]!; rows.unshift(commandFixture({ id: "f8f2f2d6-e380-492a-a9dc-d0b9ba792136", created_at: "2026-09-28T12:01:00Z", actor_display_name: "New actor" }));
  await page.getByRole("button", { name: "Наступні команди", exact: true }).click(); await expect(table).toContainText("Actor 20"); await expect(table).not.toContainText("Actor 19");
  expect(queries.at(-1)!.get("before_id")).toBe(boundary.id); expect(queries.at(-1)!.get("offset")).toBeNull();
  await expect(page.getByRole("button", { name: "Наступні команди", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Оновити журнал", exact: true }).click(); await expect(table).toContainText("New actor");
  foreign = true; await page.getByRole("button", { name: "Оновити журнал", exact: true }).click(); await expect(table).toHaveCount(0);
});

test("browser offline during confirmation blocks sending and reconnection does not submit", async ({ page, context }) => {
  let posts = 0; await mockPost(page, async (route) => { posts++; await route.abort(); });
  await page.goto(path); await controls(page).getByRole("button", { name: "Запустити", exact: true }).click();
  await context.setOffline(true); await expect(page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click(); await context.setOffline(false);
  await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeEnabled(); expect(posts).toBe(0);
});

test("manual mode and hidden tab pause selected command polling", async ({ page }) => {
  await page.clock.install(); let gets = 0;
  await mockPost(page, async (route, body) => fulfillJson(route, 201, commandFixture(body)));
  await mockDetail(page, () => { gets++; return commandFixture(); });
  await page.goto(path); await confirm(page); await expect(detail(page)).toContainText("У черзі");
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("0"); const initial = gets;
  await page.clock.fastForward(11_000); expect(gets).toBe(initial);
  await page.getByLabel("Автооновлення", { exact: true }).selectOption("30");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(detail(page).getByRole("button", { name: "Оновити стан команди" })).toBeDisabled(); const hidden = gets;
  await page.clock.fastForward(11_000); expect(gets).toBe(hidden);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`collapsing command audit releases its space and survives refresh at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockPost(page, async (route, body) => fulfillJson(route, 201, commandFixture(body)));
    await page.goto(path);
    await page.getByLabel("Автооновлення", { exact: true }).selectOption("0");
    await confirm(page);
    const card = detail(page);
    await expect(card.locator(".status-badge")).toHaveText("У черзі");
    const summary = card.getByText("Автор і технічні деталі команди", { exact: true });
    const height = () => card.evaluate((element) => element.getBoundingClientRect().height);
    const collapsedHeight = await height();
    for (const keyboard of [false, true]) {
      await summary.click();
      await expect(card.locator(".command-json")).toBeVisible();
      await expect.poll(height).toBeGreaterThan(collapsedHeight + 100);
      if (keyboard) { await summary.focus(); await summary.press("Enter"); } else await summary.click();
      await expect(card.locator(".command-json")).toBeHidden();
      await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
    }
    // Collapsed geometry is also the new reserve when a request fails.
    await page.route(detailUrl, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 503, { detail: "Command unavailable" }); });
    await card.getByRole("button", { name: "Оновити стан команди" }).click();
    await expect(card.getByRole("alert")).toContainText("Command unavailable");
    await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
    await mockDetail(page);
    await card.getByRole("button", { name: "Оновити стан команди" }).click();
    await expect(card.locator(".status-badge")).toHaveText("У черзі");
    await expect.poll(async () => Math.abs(await height() - collapsedHeight)).toBeLessThanOrEqual(2);
  });
}


for (const stalled of [false, true]) test(`Stop remains available with ${stalled ? "in-flight" : "uncertain"} Start`, async ({ page }) => {
  const posts: CommandInput[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await mockPost(page, async (route, body) => {
    posts.push(body);
    if (body.command_type === "vfd.start") {
      if (stalled) { await gate; await fulfillJson(route, 201, commandFixture(body)).catch(() => {}); }
      else await route.abort("failed");
    } else await fulfillJson(route, 201, commandFixture(body));
  });
  try {
    await page.goto(path); await confirm(page);
    await expect.poll(() => posts.length).toBe(1);
    if (!stalled) await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
    await expect(controls(page).getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
    await expect(controls(page).getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
    await confirm(page, "Зупинити");
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]!.supersedes_request_id).toBe(posts[0]!.request_id);
    expect(posts[1]!.request_id).not.toBe(posts[0]!.request_id);
    await expect(controls(page)).toContainText("Сервер прийняв команду");
    release();
    await expect(controls(page).getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toHaveCount(0);
  } finally { release(); }
});

test("frequency uses installation limits and rechecks them before POST", async ({ page }) => {
  let maximum = 50, posts = 0;
  await mockOverview(page, () => ({ ...controlOverview(), frequency_limits: { min_hz: 20, max_hz: maximum } }));
  await mockPost(page, async (route) => { posts++; await route.abort(); });
  await page.goto(path);
  const button = controls(page).getByRole("button", { name: "Задати частоту", exact: true });
  for (const value of ["19", "51"]) { await page.getByLabel("Задана частота, Гц").fill(value); await expect(button).toBeDisabled(); }
  await page.getByLabel("Задана частота, Гц").fill("45"); await button.click(); maximum = 40;
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click();
  await expect(controls(page)).toContainText("Частота поза налаштованими межами"); expect(posts).toBe(0);
});

test("missing frequency profile fails closed while Stop accepts default TTL", async ({ page }) => {
  const posts: CommandInput[] = [];
  await mockOverview(page, () => ({ ...controlOverview(), frequency_limits: null }));
  await mockPost(page, async (route, body) => { posts.push(body); await fulfillJson(route, 201, commandFixture(body)); });
  await page.goto(path);
  await expect(page.getByLabel("Задана частота, Гц")).toBeDisabled();
  await expect(controls(page)).toContainText("Спочатку налаштуйте допустимі межі");
  await page.getByText("Додаткові налаштування команди", { exact: true }).click();
  await page.getByLabel("Час на прийняття команди, с").fill("4");
  await confirm(page, "Зупинити"); await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.ttl_seconds).toBe(30);
});

test("repeated uncertain Stop preserves the original Start fence", async ({ page }) => {
  const posts: CommandInput[] = [];
  await mockPost(page, async (route, body) => {
    posts.push(body);
    if (posts.length < 3) await route.abort("failed");
    else await fulfillJson(route, 201, commandFixture(body));
  });
  await page.goto(path); await confirm(page);
  await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
  await confirm(page, "Зупинити");
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByRole("heading", { name: "Прийом команди не підтверджено" })).toBeVisible();
  await confirm(page, "Зупинити");
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[1]!.supersedes_request_id).toBe(posts[0]!.request_id);
  expect(posts[2]!.supersedes_request_id).toBe(posts[0]!.request_id);
  await expect(controls(page)).toContainText("Сервер прийняв команду");
});
