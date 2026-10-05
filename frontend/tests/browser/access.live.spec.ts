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
  await page.goto("/ui-kit/device-demo");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fui-kit%2Fdevice-demo$/u);

  await page.getByLabel("Логін").fill(VIEWER_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(VIEWER_PASSWORD);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/ui-kit\/device-demo$/u);
  await expect(page.getByText(VIEWER_EMAIL)).toBeVisible();
  await expect(page.getByText("Спостерігач", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText(/не має permission command\.execute/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Налаштування" })).toBeDisabled();
  if (process.env.KERUMO_RUN_ALARM_DEMO === "1") {
    expect(process.env.KERUMO_API_BASE_URL).toBe("http://127.0.0.1:8001");
    await page.goto("/alarms");
    await page.getByRole("link", { name: "DEMO: окремий датчик тиску", exact: true }).click();
    await page.getByLabel("Тип аварії", { exact: true }).fill("demo.frontend.acknowledgement");
    await page.getByRole("button", { name: "Застосувати тип" }).click();
    await page.getByRole("link", { name: "DEMO: acknowledgement check", exact: true }).click();
    await expect(page.getByText("Ваша роль дозволяє перегляд, але не підтвердження аварій.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Підтвердити отримання", exact: true })).toHaveCount(0);
  }
});
