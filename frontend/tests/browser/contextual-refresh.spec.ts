import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { overviewWithFrequencyFixture } from "../fixtures/overview";
import { seriesFixture } from "../fixtures/series";
import { displaySettings, refreshButton } from "../helpers/customer-details";
import {
  API_ORIGIN,
  DEVICE_ID,
  DEVICES_URL,
  ORGANIZATION_ID,
  SITE_ID,
  availabilityPayload,
  devicePayload,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";

const base = `${API_ORIGIN}/api/v1/devices/${DEVICE_ID}`;
const controllerId = "11111111-1111-4111-8111-111111111111";
type Counts = Record<"overview" | "charts" | "schedules" | "journal" | "events" | "equipment" | "access", number>;

async function setup(page: Page) {
  await mockAuthenticatedWorkspace(page);
  const counts: Counts = { overview: 0, charts: 0, schedules: 0, journal: 0, events: 0, equipment: 0, access: 0 };
  const paths: [keyof Counts, string, unknown][] = [
    ["overview", `${base}/overview`, overviewWithFrequencyFixture(devicePayload())],
    ["schedules", `${base}/schedules`, []],
    ["journal", `${base}/commands?*`, []],
    ["events", `${base}/events?*`, []],
    [
      "equipment",
      `${base}/equipment`,
      {
        device_id: DEVICE_ID,
        controller_uid: devicePayload().uid,
        controller_id: controllerId,
        firmware_version: "0.8.1",
        installations: [],
        modules: [],
        desired: null,
        reported: null,
        configuration_state: "legacy",
      },
    ],
    [
      "access",
      `${API_ORIGIN}/api/v1/connect/${controllerId}/status`,
      {
        controller_id: controllerId,
        generation: 1,
        credential_revision: 1,
        credential_state: "active",
        access_revoked: false,
        last_contact_at: null,
      },
    ],
  ];
  for (const [key, path, data] of paths)
    await page.route(path, async (route) => {
      if (await fulfillPreflight(route)) return;
      expect(route.request().method()).toBe("GET");
      counts[key]++;
      await fulfillJson(route, 200, data);
    });
  await page.route(`${base}/telemetry/series?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    counts.charts++;
    const params = new URL(route.request().url()).searchParams;
    const metric = params.get("metric")!;
    const data = seriesFixture(
      { start: params.get("start")!, end: params.get("end")!, bucket_seconds: Number(params.get("bucket_seconds")) },
      metric,
      DEVICE_ID,
      true,
    );
    await fulfillJson(route, 200, { ...data, unit: metric.endsWith("_hz") ? "Hz" : "bar" });
  });
  return counts;
}

test("the shared action refreshes only the visible tab after every tab was visited", async ({ page }) => {
  const counts = await setup(page);
  await page.goto(`/devices/${DEVICE_ID}`);
  await (await displaySettings(page)).selectOption("0");
  for (const tab of ["Графіки", "Розклади", "Журнал", "Обладнання"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(await refreshButton(page, "Оновити дані")).toBeEnabled();
  }
  for (const [tab, expected] of [
    ["Графіки", ["charts"]],
    ["Розклади", ["schedules"]],
    ["Журнал", ["journal", "events"]],
    ["Обладнання", ["equipment"]],
    ["Панель", ["overview"]],
  ] as [string, (keyof Counts)[]][]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const button = await refreshButton(page, tab === "Панель" ? "Оновити панель" : "Оновити дані");
    await expect(button).toBeEnabled();
    const before = { ...counts };
    await button.click();
    for (const key of expected) await expect.poll(() => counts[key]).toBe(before[key] + 1);
    await expect(button).toBeEnabled();
    expect(counts).toEqual(
      Object.fromEntries(
        Object.entries(before).map(([key, count]) => [key, count + (expected.includes(key as keyof Counts) ? 1 : 0)]),
      ),
    );
    await expect(page.locator(".refresh-settings")).toHaveCount(0);
  }
});

test("equipment refresh includes open access details and drops them when collapsed", async ({ page }) => {
  const counts = await setup(page);
  await page.goto(`/devices/${DEVICE_ID}?view=equipment`);
  await (await displaySettings(page)).selectOption("0");
  await page.getByRole("button", { name: "Керувати доступом" }).click();
  await expect(page.getByText("Мережевий доступ активний.", { exact: true })).toBeVisible();
  const button = await refreshButton(page, "Оновити дані");
  await expect(button).toBeEnabled();
  const before = { ...counts };
  await button.click();
  await expect.poll(() => counts.access).toBe(before.access + 1);
  await expect.poll(() => counts.equipment).toBe(before.equipment + 1);
  expect(counts.overview).toBe(before.overview);
  await page.getByRole("button", { name: "Згорнути дії", exact: true }).click();
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(() => counts.equipment).toBe(before.equipment + 2);
  expect(counts.access).toBe(before.access + 1);
});

test("refresh retains the selected metric, period and open measurements table", async ({ page }) => {
  await setup(page);
  await page.goto(`/devices/${DEVICE_ID}?view=charts`);
  await (await displaySettings(page)).selectOption("0");
  await page.getByLabel("Показник", { exact: true }).selectOption("vfd.frequency_hz");
  await page.getByLabel("Період", { exact: true }).selectOption("43200");
  await expect(page.locator(".telemetry-chart")).toBeVisible();
  await page.getByText("Таблиця вимірювань", { exact: true }).click();
  const button = await refreshButton(page, "Оновити дані");
  await expect(button).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.request().method() === "GET" && r.url().includes("/telemetry/series?"),
  );
  await button.click();
  const params = new URL((await response).url()).searchParams;
  expect(params.get("metric")).toBe("vfd.frequency_hz");
  expect(Date.parse(params.get("end")!) - Date.parse(params.get("start")!)).toBe(43_200_000);
  await expect(page.getByLabel("Період", { exact: true })).toHaveValue("43200");
  await expect(page.getByRole("table")).toBeVisible();
});

test("device list has one action and checks availability once per refresh", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let lists = 0,
    presence = 0;
  await page.route(`${DEVICES_URL}?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    lists++;
    await fulfillJson(route, 200, [devicePayload()]);
  });
  await page.route(`${base}/availability`, async (route) => {
    if (await fulfillPreflight(route)) return;
    presence++;
    await fulfillJson(route, 200, availabilityPayload());
  });
  await page.goto(`/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}/devices`);
  const button = await refreshButton(page, "Оновити дані");
  await expect(button).toBeEnabled();
  const before = { lists, presence };
  await button.click();
  await expect.poll(() => lists).toBe(before.lists + 1);
  await expect.poll(() => presence).toBe(before.presence + 1);
  await expect(button).toBeEnabled();
  await expect(page.getByText("Налаштування відображення", { exact: true })).toHaveCount(1);
  await expect(page.locator(".refresh-settings")).toHaveCount(0);
});

for (const width of [320, 393, 768, 1280])
  test(`shared controls fit and remain accessible at ${width}px`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 852 });
    await page.goto(`/devices/${DEVICE_ID}?view=charts`);
    await (await displaySettings(page)).selectOption("0");
    const settings = page.locator(".panel-display-settings");
    const buttons = settings.getByRole("button");
    await expect(buttons).toHaveCount(2);
    const boxes = await Promise.all((await buttons.all()).map((button) => button.boundingBox()));
    for (const box of boxes) {
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const gap =
      width <= 520 ? boxes[1]!.y - boxes[0]!.y - boxes[0]!.height : boxes[1]!.x - boxes[0]!.x - boxes[0]!.width;
    expect(gap).toBeGreaterThanOrEqual(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".panel-display-settings")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await test
      .info()
      .attach(`shared-settings-${width}`, { body: await settings.screenshot(), contentType: "image/png" });
    await page.getByRole("tab", { name: "Панель", exact: true }).click();
    await expect(settings.getByRole("button")).toHaveCount(1);
  });
