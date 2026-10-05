import { expect, test } from "@playwright/test";

import {
  fillLogin,
  mockAuthenticatedWorkspace,
  mockBrowserLoginSuccess,
  mockIdentity,
  mockMissingBrowserSession,
  mockRefreshSuccess,
} from "./auth-fixtures";

test("anonymous direct navigation is redirected to login without tenant-data flash", async ({ page }) => {
  await mockMissingBrowserSession(page);

  await page.goto("/alarms");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Falarms$/u);
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Аварії та інциденти" })).not.toBeVisible();
  await expect(page.getByText("DEMO: клієнт A")).not.toBeVisible();
});

test("safe returnTo resumes the requested protected route after real login state resolves", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await mockIdentity(page);
  await mockBrowserLoginSuccess(page);

  await page.goto("/alarms");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Falarms$/u);
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/alarms$/u);
  await expect(page.getByRole("heading", { name: "Аварії та інциденти" })).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
});

test("route permission blocks an authenticated user before the page content renders", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, {
    role: "viewer",
    permissions: ["organization.read", "site.read", "device.read", "telemetry.read", "capability.read"],
  });

  await page.goto("/alarms");

  await expect(page.getByRole("heading", { name: "Недостатньо прав" })).toBeVisible();
  await expect(page.getByText(/permission alarm\.read/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Аварії та інциденти" })).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти до доступного розділу" })).toHaveAttribute("href", "/devices");
});

test("viewer can read devices but command controls stay disabled by backend permission", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { role: "viewer" });

  await page.goto("/ui-kit/device-demo");

  await expect(page.getByRole("heading", { name: "Насосна станція №1" })).toBeVisible();
  await expect(page.getByText(/Owner · Спостерігач/u)).toBeVisible();
  await expect(page.getByText(/не має permission command\.execute/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустити" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Зупинити" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Аварії" })).toBeVisible();
});

test("profile or permission API outage is not treated as anonymous access", async ({ page }) => {
  await mockRefreshSuccess(page);
  await mockIdentity(page, { meNetworkFailure: true });

  await page.goto("/devices");

  await expect(page.getByRole("heading", { name: "Не вдалося перевірити права" })).toBeVisible();
  await expect(page.getByText(/tenant data/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторити" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();
  await expect(page).toHaveURL(/\/devices$/u);
});

test("an authenticated account without active membership receives an explicit no-access state", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { memberships: [], organizations: [] });

  await page.goto("/devices");

  await expect(page.getByRole("heading", { name: "Додайте свій перший контролер" })).toBeVisible();
  await expect(page.getByText(/У майстрі активації ви створите об’єкт/u)).toBeVisible();
  await expect(page.locator(".access-gate-mark-busy")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Додати контролер", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();
});
