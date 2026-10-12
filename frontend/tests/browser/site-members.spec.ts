import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  API_ORIGIN,
  ORGANIZATION_ID,
  SITE_ID,
  SESSION_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  sitePayload,
  ownerPermissions,
} from "./auth-fixtures";

const secondId = "22222222-2222-4222-8222-222222222222";
const email = "operator@example.com";
const sites = [sitePayload(), { ...sitePayload(), id: secondId, name: "Друга насосна", code: "second" }];
const member = {
  id: SESSION_ID,
  organization_id: ORGANIZATION_ID,
  user_id: secondId,
  user_email: email,
  user_display_name: "Оператор",
  role: "operator",
  is_active: true,
  site_ids: [SITE_ID, secondId],
  expires_at: null,
  created_at: "2026-09-27T12:00:00Z",
  updated_at: "2026-09-27T12:00:00Z",
};
async function setup(page: Page, members: unknown[] = []) {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/sites?*`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, sites);
  });
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/memberships`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, members);
  });
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/invitations`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, []);
  });
  await page.route(`${API_ORIGIN}/api/v1/sites/${secondId}`, async (route) => {
    if (!(await fulfillPreflight(route))) await fulfillJson(route, 200, sites[1]);
  });
  await page.goto(`/organizations/${ORGANIZATION_ID}/members`);
  await expect(page.getByRole("heading", { name: "Учасники та доступ", exact: true })).toBeVisible();
}

test("invitation defaults to limited viewing and requires chosen sites before any POST", async ({ page }) => {
  await setup(page);
  let posts = 0;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/invitations`, async (route) => {
    if (await fulfillPreflight(route)) return;
    if (route.request().method() === "POST") {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ email, role: "viewer", site_ids: [SITE_ID], expires_at: null });
      await fulfillJson(route, 201, {});
    } else await fulfillJson(route, 200, []);
  });
  await expect(page.getByLabel("Доступ до", { exact: true })).toHaveValue("sites");
  await expect(page.getByLabel("Права учасника", { exact: true })).toHaveValue("viewer");
  await expect(page.getByLabel("Права учасника").locator('option[value="owner"]')).toHaveCount(0);
  await page.getByLabel("Пошта учасника").fill(email);
  await expect(page.getByRole("button", { name: "Надіслати запрошення" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Тестовий об’єкт", exact: true }).check();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Надіслати запрошення" }).click();
  await expect(page.getByRole("status")).toContainText("Запрошення надіслано");
  expect(posts).toBe(1);
});

test("organization-wide owner access requires an explicit scope choice", async ({ page }) => {
  await setup(page);
  let posts = 0;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/invitations`, async (route) => {
    if (await fulfillPreflight(route)) return;
    if (route.request().method() === "POST") {
      posts++;
      expect(route.request().postDataJSON()).toEqual({ email, role: "owner", site_ids: null, expires_at: null });
      await fulfillJson(route, 201, {});
    } else await fulfillJson(route, 200, []);
  });
  await page.getByLabel("Доступ до", { exact: true }).selectOption("organization");
  await page.getByLabel("Права учасника", { exact: true }).selectOption("owner");
  await expect(page.getByLabel("Доступ до", { exact: true })).toBeDisabled();
  await page.getByLabel("Пошта учасника").fill(email);
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Надіслати запрошення" }).click();
  await expect(page.getByRole("status")).toContainText("Запрошення надіслано");
  expect(posts).toBe(1);
});

test("existing member scope and role change only on Save and preserve untouched expiry", async ({ page }) => {
  const expires = "2027-01-01T12:30:59Z";
  await setup(page, [{ ...member, expires_at: expires }]);
  let patches = 0;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/memberships/${SESSION_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    patches++;
    expect(route.request().postDataJSON()).toEqual({
      role: "viewer",
      site_ids: [SITE_ID],
      expected_updated_at: member.updated_at,
    });
    await fulfillJson(route, 200, {});
  });
  await page.getByRole("button", { name: "Налаштувати доступ", exact: true }).click();
  const form = page.getByRole("form", { name: `Доступ для ${email}` });
  await expect(form.getByRole("button", { name: "Зберегти доступ", exact: true })).toBeDisabled();
  await expect(form.getByRole("checkbox", { name: "Тестовий об’єкт", exact: true })).toBeChecked();
  await expect(form.getByRole("checkbox", { name: "Друга насосна", exact: true })).toBeChecked();
  await form.getByRole("checkbox", { name: "Друга насосна", exact: true }).uncheck();
  await form.getByLabel("Права учасника", { exact: true }).selectOption("viewer");
  expect(patches).toBe(0);
  await form.getByRole("button", { name: "Зберегти доступ", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Права та об’єкти учасника оновлено");
  expect(patches).toBe(1);
});

test("role-only edit sends no old scope and a stale access record is rejected without retry", async ({ page }) => {
  await setup(page, [member]);
  let patches = 0;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/memberships/${SESSION_ID}`, async (route) => {
    if (await fulfillPreflight(route)) return;
    patches++;
    expect(route.request().postDataJSON()).toEqual({ role: "viewer", expected_updated_at: member.updated_at });
    await fulfillJson(route, 409, {
      detail: "Доступ учасника вже змінено. Оновіть список і перевірте актуальні права.",
    });
  });
  await page.getByRole("button", { name: "Налаштувати доступ", exact: true }).click();
  const form = page.getByRole("form", { name: `Доступ для ${email}` });
  await form.getByLabel("Права учасника", { exact: true }).selectOption("viewer");
  await form.getByRole("button", { name: "Зберегти доступ", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Доступ учасника вже змінено");
  expect(patches).toBe(1);
});

test("site-only admin receives no organization member controls or member requests", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, {
    role: "admin",
    permissions: ownerPermissions.filter(
      (key) => !["membership.read", "membership.manage", "site.create"].includes(key),
    ),
  });
  let reads = 0;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/memberships`, async (route) => {
    if (!(await fulfillPreflight(route))) {
      reads++;
      await fulfillJson(route, 403, {});
    }
  });
  await page.goto(`/organizations/${ORGANIZATION_ID}/members`);
  await expect(page.getByRole("heading", { name: "Учасники недоступні", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Надіслати запрошення" })).toHaveCount(0);
  expect(reads).toBe(0);
});

test("scope selection preserves an earlier page when selecting another site on the next page", async ({ page }) => {
  await setup(page);
  const many = Array.from({ length: 21 }, (_, i) => ({
    ...sitePayload(),
    id: i === 0 ? SITE_ID : `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    name: `Об’єкт ${i + 1}`,
  }));
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/sites?*`, async (route) => {
    if (await fulfillPreflight(route)) return;
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    await fulfillJson(route, 200, many.slice(offset, offset + 21));
  });
  await page.getByRole("button", { name: "Оновити список" }).click();
  await page.reload();
  await page.getByRole("checkbox", { name: "Об’єкт 1", exact: true }).check();
  await page.getByRole("button", { name: "Наступні об’єкти" }).click();
  await page.getByRole("checkbox", { name: "Об’єкт 21", exact: true }).check();
  let sent: unknown;
  await page.route(`${API_ORIGIN}/api/v1/organizations/${ORGANIZATION_ID}/invitations`, async (route) => {
    if (await fulfillPreflight(route)) return;
    if (route.request().method() === "POST") {
      sent = route.request().postDataJSON();
      await fulfillJson(route, 201, {});
    } else await fulfillJson(route, 200, []);
  });
  await page.getByLabel("Пошта учасника").fill(email);
  await page.getByRole("button", { name: "Надіслати запрошення" }).click();
  await expect(page.getByRole("status")).toContainText("Запрошення надіслано");
  expect(sent).toMatchObject({ site_ids: [SITE_ID, many[20]!.id] });
});

for (const width of [320, 1280])
  test(`site invitation and member editor reflow and remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await setup(page, [member]);
    await page.getByRole("button", { name: "Налаштувати доступ" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
    ).toEqual([]);
  });

test("invitation recipient sees exactly the granted object names and expiry before accepting", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { email });
  const token = "f".repeat(32) + "." + "k".repeat(43);
  await page.route(`${API_ORIGIN}/api/v1/invitations/inspect`, async (route) => {
    if (!(await fulfillPreflight(route)))
      await fulfillJson(route, 200, {
        email,
        role: "operator",
        organization_name: "Customer",
        site_names: ["Одна насосна"],
        access_expires_at: "2027-01-01T12:00:00Z",
      });
  });
  await page.goto(`/invite#token=${token}`);
  await expect(page.getByText("Об’єкти: Одна насосна", { exact: true })).toBeVisible();
  await expect(page.getByText("Доступ до всієї організації", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Доступ до 01/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Прийняти запрошення" })).toBeVisible();
});
