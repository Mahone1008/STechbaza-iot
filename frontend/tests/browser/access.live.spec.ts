import { expect, test } from "@playwright/test";

const VIEWER_EMAIL = process.env.KERUMO_VIEWER_EMAIL;
const VIEWER_PASSWORD = process.env.KERUMO_VIEWER_PASSWORD;

if (!VIEWER_EMAIL || !VIEWER_PASSWORD) {
  throw new Error("KERUMO_VIEWER_EMAIL and KERUMO_VIEWER_PASSWORD are required for live access tests.");
}

test("real anonymous navigation never renders a protected workspace", async ({ page }) => {
  await page.goto("/devices");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdevices$/u);
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();
  await expect(page.getByText("DEMO: клієнт A")).not.toBeVisible();
});

test("real viewer profile drives navigation and blocks command controls", async ({ page }) => {
  await page.goto("/devices/north-pump");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdevices%2Fnorth-pump$/u);

  await page.getByLabel("Email").fill(VIEWER_EMAIL);
  await page.getByLabel("Пароль").fill(VIEWER_PASSWORD);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/devices\/north-pump$/u);
  await expect(page.getByText(VIEWER_EMAIL)).toBeVisible();
  await expect(page.getByText(/DEMO: viewer · Спостерігач/u)).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText(/не має permission command\.execute/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Налаштування" })).toBeDisabled();
});
