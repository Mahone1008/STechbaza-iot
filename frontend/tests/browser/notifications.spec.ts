import { expect, test, type Page, type Route } from "@playwright/test";
import { notificationFixture, notificationId } from "../fixtures/notifications";
import type { Notification } from "../../src/lib/api/notifications";
import { API_ORIGIN, ORGANIZATION_ID, DEVICE_ID, USER_ID, corsHeaders, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, viewerPermissions } from "./auth-fixtures";

test.describe.configure({ retries: 0 });
const feedPath = `/organizations/${ORGANIZATION_ID}/notifications`;
const path = `${feedPath}/${notificationId}`;
const feedUrl = `${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/notifications`;
const detailUrl = `${API_ORIGIN}/api/v1/notifications/${notificationId}`;
const table = (page: Page) => page.getByRole("table", { name: "Повідомлення організації" });
const card = (page: Page) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Подія та прочитання", exact: true }) });
async function get(page: Page, url: string, value: () => unknown) { await page.route(url, async (route) => { if (await fulfillPreflight(route)) return; await fulfillJson(route, 200, value()); }); }
async function post(page: Page, handler: (route: Route) => Promise<void>) { await page.route(`${detailUrl}/read`, async (route) => { if (await fulfillPreflight(route)) return; expect(route.request().method()).toBe("POST"); await handler(route); }); }
test.beforeEach(async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await get(page, `${feedUrl}?*`, () => [notificationFixture()]);
  await get(page, `${feedUrl}/unread-count`, () => ({ unread_count: 1 }));
  await get(page, detailUrl, notificationFixture);
});

test("feed uses one bounded organization list and one count without device fan-out or automatic reads", async ({ page }) => {
  const requests: string[] = []; let writes = 0;
  page.on("request", (r) => { if (r.url().startsWith(API_ORIGIN)) { if (r.method() === "GET") requests.push(r.url()); if (r.method() === "POST" && r.url().endsWith("/read")) writes++; } });
  await page.goto("/notifications"); await expect(table(page)).toContainText("Низький тиск");
  await expect(page.getByText("Непрочитаних вами:")).toContainText("1");
  const list = requests.filter((url) => url.startsWith(`${feedUrl}?`)); expect(list).toHaveLength(1);
  expect(Object.fromEntries(new URL(list[0]!).searchParams)).toEqual({ limit: "21", offset: "0", unread_only: "false" });
  expect(requests.filter((url) => /\/(devices|alarms|overview)(\/|\?|$)/u.test(url))).toHaveLength(0);
  expect(requests.filter((url) => url.endsWith("/unread-count"))).toHaveLength(1);
  await table(page).getByRole("link", { name: "Низький тиск" }).click(); await expect(card(page)).toContainText("Не прочитано вами"); expect(writes).toBe(0);
});

test("unread filter, bounded pagination and refresh reset use server parameters", async ({ page }) => {
  const rows = Array.from({ length: 23 }, (_, i) => notificationFixture({ id: `18f2f2d6-e380-492a-a9dc-${String(i).padStart(12, "0")}`, title: `Подія ${i}` }));
  const queries: URLSearchParams[] = [];
  await page.route(`${feedUrl}?*`, async (route) => { if (await fulfillPreflight(route)) return; const q = new URL(route.request().url()).searchParams; queries.push(q); const offset = Number(q.get("offset")); await fulfillJson(route, 200, rows.slice(offset, offset + 21)); });
  await page.goto(feedPath); await expect(table(page)).toContainText("Подія 19"); await expect(table(page).getByRole("link", { name: "Подія 20", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Наступна сторінка" }).click(); await expect(table(page)).toContainText("Подія 20");
  await page.getByLabel("Показати повідомлення", { exact: true }).selectOption("unread"); await expect(table(page)).toContainText("Подія 0");
  expect(Object.fromEntries(queries.at(-1)!)).toEqual({ limit: "21", offset: "0", unread_only: "true" });
  await page.getByRole("button", { name: "Наступна сторінка" }).click(); await expect(table(page)).toContainText("Подія 20");
  await page.getByRole("button", { name: "Оновити повідомлення" }).click(); await expect(table(page)).toContainText("Подія 0");
});

for (const endpoint of ["list", "count"]) test(`${endpoint} failure hides previous list and count until explicit recovery`, async ({ page }) => {
  await page.goto(feedPath); await expect(table(page)).toBeVisible();
  const url = endpoint === "list" ? `${feedUrl}?*` : `${feedUrl}/unread-count`;
  let fail = true, calls = 0;
  await page.route(url, async (route) => { if (await fulfillPreflight(route)) return; calls++; await fulfillJson(route, fail ? 403 : 200, fail ? { detail: "Access revoked" } : endpoint === "list" ? [notificationFixture()] : { unread_count: 1 }); });
  await page.getByRole("button", { name: "Оновити повідомлення" }).click(); await expect(page.getByRole("heading", { name: "Повідомлення недоступні" })).toBeVisible();
  await expect(table(page)).toHaveCount(0); await expect(page.getByText("Непрочитаних вами:")).toHaveCount(0); expect(calls).toBe(1);
  fail = false; await page.getByRole("button", { name: "Оновити повідомлення" }).click(); await expect(table(page)).toBeVisible(); expect(calls).toBe(2);
});

test("empty feed is explicit and foreign tenant snapshots are rejected", async ({ page }) => {
  let rows: Notification[] = []; await get(page, `${feedUrl}?*`, () => rows); await get(page, `${feedUrl}/unread-count`, () => ({ unread_count: 0 }));
  await page.goto(feedPath); await expect(page.getByText("За вибраним фільтром повідомлень немає.")).toBeVisible();
  rows = [notificationFixture({ organization_id: DEVICE_ID, title: "Foreign secret" })];
  await page.getByRole("button", { name: "Оновити повідомлення" }).click(); await expect(page.getByRole("heading", { name: "Повідомлення недоступні" })).toBeVisible(); await expect(page.getByText("Foreign secret")).toHaveCount(0);
});

test("notification permission gates explicit tenant routes before reads", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { permissions: viewerPermissions.filter((p) => p !== "notification.read") });
  let reads = 0; await get(page, detailUrl, () => { reads++; return notificationFixture(); });
  await page.goto(path); await expect(page.getByRole("heading", { name: "Недостатньо прав" })).toBeVisible(); expect(reads).toBe(0);
});

test("foreign detail is never rendered and has no incident link or read action", async ({ page }) => {
  await get(page, detailUrl, () => notificationFixture({ organization_id: DEVICE_ID, title: "Foreign secret" }));
  await page.goto(path); await expect(page.getByRole("heading", { name: "Повідомлення недоступні" })).toBeVisible(); await expect(page.getByText("Foreign secret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toHaveCount(0); await expect(page.getByRole("link", { name: "До інциденту" })).toHaveCount(0);
});

test("viewer explicitly marks personal read once, preserves F5 and updates count without alarm ACK", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer" }); let row = notificationFixture(), posts = 0, acks = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/acknowledge")) acks++; });
  await get(page, detailUrl, () => row); await get(page, `${feedUrl}?*`, () => [row]); await get(page, `${feedUrl}/unread-count`, () => ({ unread_count: row.read_at ? 0 : 1 }));
  await post(page, async (route) => { posts++; row = notificationFixture({ read_at: "2026-09-28T12:01:00Z" }); await fulfillJson(route, 200, { notification_id: row.id, read_at: row.read_at }); });
  await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(card(page)).toContainText("Стан перевірено: повідомлення прочитане вами."); expect(posts).toBe(1); expect(acks).toBe(0);
  await page.reload(); await expect(card(page).locator(".status-badge")).toContainText(["Виникла аварія", "Попередження", "Прочитано вами"]); expect(posts).toBe(1);
  await page.getByRole("link", { name: "До повідомлень" }).click(); await expect(page.getByText("Непрочитаних вами:")).toContainText("0");
});

for (const saved of [true, false]) test(`uncertain personal read reconciles through GET before another POST, saved=${saved}`, async ({ page }) => {
  let row = notificationFixture(), posts = 0; await get(page, detailUrl, () => row);
  await post(page, async (route) => { posts++; if (posts === 1) { if (saved) row = notificationFixture({ read_at: "2026-09-28T12:01:00Z" }); await route.abort("failed"); } else { row = notificationFixture({ read_at: "2026-09-28T12:02:00Z" }); await fulfillJson(route, 200, { notification_id: row.id, read_at: row.read_at }); } });
  await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect(card(page)).toContainText("Результат прочитання невідомий");
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeDisabled(); expect(posts).toBe(1);
  await page.getByRole("button", { name: "Перевірити повідомлення" }).click();
  if (saved) { await expect(card(page)).toContainText("Стан перевірено: повідомлення прочитане вами."); expect(posts).toBe(1); }
  else { await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeEnabled(); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect(card(page)).toContainText("Стан перевірено: повідомлення прочитане вами."); expect(posts).toBe(2); }
});

test("429 keeps Retry-After after successful GET and never automatically replays a write", async ({ page }) => {
  await page.clock.install(); let posts = 0;
  await post(page, async (route) => { posts++; await route.fulfill({ status: 429, headers: { ...corsHeaders, "content-type": "application/json", "Retry-After": "10" }, body: JSON.stringify({ detail: "Slow down" }) }); });
  await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect(card(page)).toContainText("Результат прочитання невідомий");
  await page.getByRole("button", { name: "Перевірити повідомлення" }).click(); await expect(card(page)).toContainText("Стан перевірено: повідомлення ще не прочитане вами.");
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeDisabled(); await page.clock.fastForward(11_000);
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeEnabled(); expect(posts).toBe(1);
});

for (const status of [401, 403, 404]) test(`read POST ${status} hides snapshot and cannot replay the mutation`, async ({ page }) => {
  let posts = 0; await post(page, async (route) => { posts++; await fulfillJson(route, status, { detail: "Denied" }); });
  await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect(card(page).getByRole("heading", { name: "Повідомлення недоступні" })).toBeVisible();
  await expect(card(page).getByRole("heading", { name: "Низький тиск" })).toHaveCount(0); await expect(page.getByRole("link", { name: "До інциденту" })).toHaveCount(0); expect(posts).toBe(1);
});

test("invalid read receipt remains uncertain until checked", async ({ page }) => {
  await post(page, async (route) => fulfillJson(route, 200, { notification_id: USER_ID, read_at: "2026-09-28T12:01:00Z" }));
  await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect(card(page)).toContainText("Результат прочитання невідомий"); await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeDisabled();
});

test("mobile escaped snapshot preserves read and alarm permissions separately", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer", permissions: viewerPermissions.filter((p) => p !== "alarm.read") }); await page.setViewportSize({ width: 390, height: 844 });
  await get(page, detailUrl, () => notificationFixture({ title: '<img src=x onerror="alert(1)">', description: "x".repeat(400) }));
  await page.goto(path); await expect(card(page)).toContainText('<img src=x onerror="alert(1)">'); await expect(card(page).locator("img, script")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeEnabled(); await expect(page.getByRole("link", { name: "До інциденту" })).toHaveCount(0);
  await expect(card(page).locator("pre")).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".mobile-nav").getByRole("link", { name: "Повідомлення" })).toBeVisible();
});

test("offline and reconnect do not replay personal read", async ({ page, context }) => {
  let posts = 0; await post(page, async (route) => { posts++; await route.abort(); });
  await page.goto(path); await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeEnabled(); await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeDisabled(); await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Позначити прочитаним" })).toBeEnabled(); expect(posts).toBe(0);
});

test("navigation aborts a pending write and rejects its late receipt", async ({ page }) => {
  let release!: () => void, started = false; const gate = new Promise<void>((resolve) => { release = resolve; });
  await post(page, async (route) => { started = true; await gate; await fulfillJson(route, 200, { notification_id: notificationId, read_at: "2026-09-28T12:01:00Z" }).catch(() => {}); });
  try {
    await page.goto(path); await page.getByRole("button", { name: "Позначити прочитаним" }).click(); await expect.poll(() => started).toBe(true);
    await page.getByRole("link", { name: "До повідомлень" }).click(); await expect(table(page)).toBeVisible(); release();
    await expect(page.getByRole("heading", { name: "Деталі повідомлення" })).toHaveCount(0); await expect(table(page)).toContainText("Не прочитано вами");
  } finally { release(); }
});
