import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { commandFixture } from "../fixtures/commands";
import { scheduleOverview } from "../fixtures/schedules";
import type { ControlMode, ControlModeInput } from "../../src/lib/api/control-mode";
import { API_ORIGIN, DEVICE_ID, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace, viewerPermissions } from "./auth-fixtures";

const url = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
function initial(mode: ControlMode["mode"] = "manual"): ControlMode {
  return { device_id: DEVICE_ID, mode, revision: 0, changed_at: null, enabled_schedule_count: 1,
    next_start_at: new Date(Date.now() + 3600_000).toISOString() };
}
test.describe.configure({ retries: 0 });
for (const width of [320, 393, 768, 1280]) test(`saved automation mode fits ${width}px and retains manual actions`, async ({ page }) => {
  let mode = initial();
  const writes: ControlModeInput[] = [];
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width, height: 852 });
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, { ...scheduleOverview(), control_mode: mode });
  });
  await page.route(`${url}/control-mode`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON() as ControlModeInput;
    writes.push(input);
    mode = { ...mode, mode: input.mode, revision: mode.revision + 1, changed_at: new Date().toISOString() };
    await fulfillJson(route, 200, mode);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  const panel = page.getByRole("region", { name: "Режим запуску" });
  await expect(panel.getByRole("button", { name: "Ручне керування", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "За розкладом", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Пропущені запуски не відновлюються");
  await page.getByRole("dialog").getByRole("button", { name: "Зберегти режим" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(panel.getByRole("button", { name: "За розкладом", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(writes).toHaveLength(1);
  await page.reload();
  await expect(panel.getByRole("button", { name: "За розкладом", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 1280) {
    const status = await page.locator(".device-status").boundingBox();
    const readings = await page.locator(".overview-result-region").boundingBox();
    expect(status).not.toBeNull(); expect(readings).not.toBeNull();
    expect(readings!.y - status!.y - status!.height).toBeLessThanOrEqual(32);
  }
  expect((await new AxeBuilder({ page }).include(".control-mode-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await test.info().attach(`control-mode-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("lost response is checked with the same request and STOP remains available", async ({ page }) => {
  let mode = initial(), first = true;
  const writes: ControlModeInput[] = [];
  await mockAuthenticatedWorkspace(page);
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, { ...scheduleOverview(), control_mode: mode });
  });
  await page.route(`${url}/control-mode`, async (route) => {
    if (await fulfillPreflight(route)) return;
    writes.push(route.request().postDataJSON());
    if (first) { first = false; mode = { ...mode, mode: "schedule", revision: 1 }; await route.abort("failed"); }
    else await fulfillJson(route, 200, mode);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "За розкладом", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Зберегти режим" }).click();
  await expect(page.getByText("Збереження режиму не підтверджено.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Зупинити", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Перевірити збереження режиму" }).click();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeEnabled();
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
});

test("manual start explains pausing schedules and captures server mode revision", async ({ page }) => {
  let mode = initial("schedule");
  const posts: Record<string, unknown>[] = [];
  await mockAuthenticatedWorkspace(page);
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, { ...scheduleOverview(), control_mode: mode });
  });
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON(); posts.push(input);
    mode = { ...mode, mode: "manual", revision: 1 };
    await fulfillJson(route, 201, commandFixture({ ...input, control_mode_revision: 1, requested_control_mode_revision: input.expected_control_mode_revision }));
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "Запустити", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("призупинить майбутні запуски за розкладом");
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click();
  await expect(page.getByText("Команду прийнято. Очікуємо результат від контролера.", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ command_type: "vfd.start", expected_control_mode_revision: 0, payload: {} });
  await expect(page.getByRole("button", { name: "Ручне керування", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("viewer sees the saved mode and cannot switch it", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { permissions: viewerPermissions, role: "viewer" });
  await page.route(`${url}/overview`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const data = scheduleOverview(); data.allowed_commands = []; for (const item of data.modules) item.allowed_commands = [];
    await fulfillJson(route, 200, { ...data, control_mode: initial("schedule") });
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("region", { name: "Режим запуску" })).toContainText("За розкладом");
  await expect(page.getByRole("button", { name: "За розкладом", exact: true })).toHaveCount(0);
});

test("a mode changed by another operator blocks the old manual confirmation before POST", async ({ page }) => {
  let mode = initial("schedule"), posts = 0;
  await mockAuthenticatedWorkspace(page);
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, { ...scheduleOverview(), control_mode: mode });
  });
  await page.route(`${url}/commands`, async (route) => { posts++; await route.abort("failed"); });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "Запустити", exact: true }).click();
  mode = { ...mode, mode: "manual", revision: 1 };
  await page.getByRole("dialog").getByRole("button", { name: "Надіслати команду" }).click();
  await expect(page.getByText("Керування змінилося. Оновіть панель і підтвердьте команду знову.", { exact: true })).toBeVisible();
  expect(posts).toBe(0);
});
