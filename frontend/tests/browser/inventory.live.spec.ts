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

test("real organization and site selection shows API devices, presence and restored deep links", async ({ page }) => {
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
  await page.getByRole("link", { name: "DEMO: насос з частотником", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEMO: насос з частотником", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Модулі та канали" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити" })).toHaveCount(0);
});

test("real backend denies foreign organization, site and device deep links", async ({ page }) => {
  for (const path of [`/organizations/${otherOrg}/sites`, `/organizations/${org}/sites/${otherSite}/devices`, `/devices/${otherDevice}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Немає доступної організації" })).toBeVisible();
    await expect(page.getByText("TB-DEMO-OTHER", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Обрати організацію" }).click();
  await expect(page.getByRole("heading", { name: "Організації", exact: true })).toBeVisible();
});
