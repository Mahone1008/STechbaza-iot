import AxeBuilder from "@axe-core/playwright";
import { settingsOverview } from "../fixtures/vfd-settings";
import { expect, test } from "@playwright/test";
import { commandFixture } from "../fixtures/commands";
import {
  API_ORIGIN,
  DEVICE_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  viewerPermissions,
} from "./auth-fixtures";
import type { CommandInput } from "../../src/lib/api/commands";

const url = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;

test("source confirmation sends one immutable CAS command and waits for actual telemetry", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 320, height: 740 });
  const data = settingsOverview();
  const posts: CommandInput[] = [];
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON();
    posts.push(input);
    await fulfillJson(route, 201, commandFixture(input));
  });
  await page.route(`${url}/commands/by-request/*`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, commandFixture(posts[0]));
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  const section = page.getByRole("region", { name: "Джерело керування" });
  await section.getByRole("button", { name: "Місцеве керування", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("кнопками панелі частотника");
  expect(
    (await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Підтвердити зміну", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({
    command_type: "vfd.source.set",
    ttl_seconds: 30,
    payload: { source: "local", expected_run_source: 2, expected_frequency_source: 6 },
  });
  await expect(section).toContainText("Дистанційне");
  await expect(section.getByRole("button", { name: "Місцеве керування", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("changed source during confirmation fails before POST; local mode blocks RUN", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = settingsOverview();
  let posts = 0;
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${url}/commands`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      posts++;
      await fulfillJson(route, 500, {});
    }
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "Місцеве керування", exact: true }).click();
  data.diagnostics!.vfd_settings!.run_source = 0;
  data.diagnostics!.vfd_settings!.frequency_source = 1;
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити зміну", exact: true }).click();
  await expect(page.getByText("Стан змінився. Оновіть показання та підтвердьте нову дію.")).toBeVisible();
  expect(posts).toBe(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Джерело керування" })).toContainText("Місцеве · панель частотника");
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toBeDisabled();
});

test("uncertain POST is checked by request ID without repeating the write", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = settingsOverview();
  let posts = 0;
  let reads = 0;
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${url}/commands`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      posts++;
      await route.abort();
    }
  });
  await page.route(`${url}/commands/by-request/*`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      reads++;
      await fulfillJson(route, 404, { detail: "Команду не знайдено" });
    }
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("button", { name: "Місцеве керування", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити зміну", exact: true }).click();
  await expect(page.getByText("Доставку не підтверджено.", { exact: false })).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Перевірити результат", exact: true }).click();
  expect(posts).toBe(1);
});

test("viewer never offers source writes; customers have no F editor", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer", permissions: viewerPermissions });
  const data = settingsOverview();
  data.access.organization_role = "viewer";
  data.access.permissions = [...viewerPermissions];
  data.allowed_commands = [];
  for (const entry of data.modules) entry.allowed_commands = [];
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("region", { name: "Джерело керування" })).toContainText("Дистанційне");
  await expect(page.getByRole("button", { name: "Місцеве керування", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сервісні параметри частотника", exact: true })).toHaveCount(0);
});

test("stale telemetry and a controller without stopped permission block switching", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const data = settingsOverview();
  data.telemetry_freshness.status = "stale";
  data.telemetry_freshness.reason = "timeout";
  data.telemetry_freshness.received_age_seconds = 180;
  for (const reading of [...data.readings, ...data.state_readings]) reading.status = "stale";
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await expect(page.getByRole("region", { name: "Джерело керування" })).toContainText("потрібні свіжі показання");
  await expect(page.getByRole("button", { name: "Місцеве керування", exact: true })).toBeDisabled();
  data.telemetry_freshness.status = "fresh";
  data.telemetry_freshness.reason = "recent";
  data.telemetry_freshness.received_age_seconds = 0;
  for (const reading of [...data.readings, ...data.state_readings]) reading.status = "fresh";
  data.diagnostics!.vfd_settings!.ready = false;
  await page.reload();
  await expect(page.getByRole("region", { name: "Джерело керування" })).toContainText("Дистанційне");
  await expect(page.getByRole("button", { name: "Місцеве керування", exact: true })).toBeDisabled();
});

test("staff F editor validates units and sends one whitelisted parameter with old value", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "service_admin", role: "service" });
  await page.setViewportSize({ width: 320, height: 740 });
  const data = settingsOverview();
  data.access.platform_role = "service_admin";
  data.access.organization_role = "service";
  data.allowed_commands.push("vfd.parameter.set");
  data.modules[3]!.allowed_commands.push("vfd.parameter.set");
  const posts: CommandInput[] = [];
  await page.route(`${url}/overview`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, data);
  });
  await page.route(`${url}/commands`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const input = route.request().postDataJSON();
    posts.push(input);
    await fulfillJson(
      route,
      201,
      commandFixture({ ...input, actor_platform_role: "service_admin", actor_organization_role: "service" }),
    );
  });
  await page.goto(`/devices/${DEVICE_ID}`);
  await page.getByRole("tab", { name: "Обладнання", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сервісні параметри частотника", exact: true })).toBeVisible();
  await page.getByLabel("Час розгону, с", { exact: true }).fill("7,55");
  await expect(page.getByRole("button", { name: "Застосувати F0.10", exact: true })).toBeDisabled();
  await page.getByLabel("Час розгону, с", { exact: true }).fill("10,1");
  await page.getByRole("button", { name: "Застосувати F0.10", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("7.5 с → 10.1 с");
  await page.getByRole("dialog").getByRole("button", { name: "Підтвердити зміну", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({
    command_type: "vfd.parameter.set",
    payload: { code: "F0.10", expected_raw: 75, value_raw: 101 },
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
