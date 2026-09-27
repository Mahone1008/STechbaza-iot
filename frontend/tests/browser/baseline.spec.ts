import { expect, test } from "@playwright/test";

test("core routes render and device navigation remains understandable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Пароль")).toBeVisible();

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Пристрої" })).toBeVisible();
  await page.getByRole("link", { name: "Насосна станція №1" }).click();
  await expect(page.getByRole("heading", { name: "Насосна станція №1" })).toBeVisible();
  await expect(page.getByText("Demo data · guard у 10.3")).toBeVisible();
});

test("critical demo action requires confirmation and never claims physical success", async ({ page }) => {
  await page.goto("/devices/north-pump");
  await page.getByRole("button", { name: "Запустити" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Підтвердити запуск" })).toBeVisible();
  await expect(dialog.getByText(/після підключення API в Етапі 12/)).toBeVisible();
  await expect(dialog.getByText(/не означає, що насос змінив фізичний стан/)).toBeVisible();
  await dialog.getByRole("button", { name: "Скасувати" }).click();
  await expect(dialog).not.toBeVisible();
});

test("API panel distinguishes success from a network failure", async ({ page }) => {
  await page.route("http://127.0.0.1:8001/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "techbaza-backend", version: "0.38.0" }),
    });
  });

  await page.goto("/ui-kit");
  await page.getByRole("button", { name: "Перевірити API" }).click();
  await expect(page.getByText("API доступний")).toBeVisible();
  await expect(page.getByText(/service techbaza-backend · version 0.38.0/)).toBeVisible();

  await page.getByRole("button", { name: "Очистити стан" }).click();
  await page.unroute("http://127.0.0.1:8001/health");
  await page.route("http://127.0.0.1:8001/health", async (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Перевірити API" }).click();
  await expect(page.getByText(/Backend недоступний/)).toBeVisible();
});

test("mobile navigation keeps the primary route visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/devices/north-pump");

  const mobileNavigation = page.getByRole("navigation", { name: "Мобільна навігація" });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Пристрої" }).click();
  await expect(page.getByRole("heading", { name: "Пристрої" })).toBeVisible();
});
