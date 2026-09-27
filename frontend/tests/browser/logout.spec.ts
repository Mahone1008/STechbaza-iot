import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

import {
  LOGOUT_URL,
  REFRESH_URL,
  corsHeaders,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  mockIdentity,
  tokenPayload,
} from "./auth-fixtures";

async function openUserMenuAndLogout(page: Page): Promise<void> {
  const sidebar = page.locator(".sidebar");
  await sidebar.getByRole("button", { name: "Відкрити меню користувача" }).click();

  const menu = page.getByRole("menu", { name: "Меню користувача" });
  await expect(menu).toBeVisible();
  const [menuBox, sidebarBox] = await Promise.all([menu.boundingBox(), sidebar.boundingBox()]);
  expect(menuBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  if (menuBox && sidebarBox) {
    expect(menuBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  }

  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).click();
}

async function routeRefresh(
  target: Page | BrowserContext,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await handler(route);
  });
}

async function routeLogout(
  target: Page | BrowserContext,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await target.route(LOGOUT_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await handler(route);
  });
}

test("successful logout sends CSRF, clears private state and cannot restore after reload", async ({ page }) => {
  let loggedOut = false;
  let refreshCalls = 0;
  let logoutCalls = 0;

  await routeRefresh(page, async (route) => {
    refreshCalls += 1;
    if (loggedOut) {
      await route.fulfill({
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ detail: "Браузерна сесія недійсна або завершилася" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify(tokenPayload("o")),
    });
  });
  await mockIdentity(page);
  await routeLogout(page, async (route) => {
    logoutCalls += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-techbaza-csrf"]).toBe("1");
    loggedOut = true;
    await route.fulfill({
      status: 204,
      headers: {
        ...corsHeaders,
        "set-cookie": "techbaza_refresh=; Path=/api/v1/auth/browser; Max-Age=0; HttpOnly; SameSite=Strict",
      },
      body: "",
    });
  });

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Пристрої" })).toBeVisible();
  await openUserMenuAndLogout(page);

  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByText("Сесію завершено")).toBeVisible();
  await expect(page.getByText("owner@example.com")).not.toBeVisible();
  expect(logoutCalls).toBe(1);

  const refreshCallsAfterLogout = refreshCalls;
  await page.reload();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  expect(refreshCalls).toBe(refreshCallsAfterLogout);

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    cookies: document.cookie,
  }));
  expect(storage.local).toHaveLength(1);
  expect(storage.local[0]?.[0]).toBe("kerumo.auth.logout.v1");
  expect(JSON.stringify(storage)).not.toContain(tokenPayload("o").access_token);
  expect(storage.session).toEqual([]);
  expect(storage.cookies).not.toContain("techbaza_refresh");
});

test("one tab logout clears every same-origin tab and prevents peer-token resurrection", async ({ context, page }) => {
  await page.close();
  let loggedOut = false;
  let refreshCalls = 0;
  let logoutCalls = 0;

  await mockIdentity(context);
  await routeRefresh(context, async (route) => {
    refreshCalls += 1;
    await route.fulfill({
      status: loggedOut ? 401 : 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify(loggedOut
        ? { detail: "Браузерна сесія недійсна або завершилася" }
        : tokenPayload("t")),
    });
  });
  await routeLogout(context, async (route) => {
    logoutCalls += 1;
    loggedOut = true;
    await route.fulfill({
      status: 204,
      headers: {
        ...corsHeaders,
        "set-cookie": "techbaza_refresh=; Path=/api/v1/auth/browser; Max-Age=0; HttpOnly; SameSite=Strict",
      },
      body: "",
    });
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/devices"), second.goto("/devices")]);
  await expect(first.getByText("owner@example.com")).toBeVisible();
  await expect(second.getByText("owner@example.com")).toBeVisible();
  expect(refreshCalls).toBe(1);

  await openUserMenuAndLogout(first);
  await expect(first).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(second).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(first.getByText("Сесію завершено")).toBeVisible();
  await expect(second.getByText("Сесію завершено")).toBeVisible();
  expect(logoutCalls).toBe(1);

  const refreshCallsAfterLogout = refreshCalls;
  await second.reload();
  await expect(second).toHaveURL(/\/login\?loggedOut=1$/u);
  expect(refreshCalls).toBe(refreshCallsAfterLogout);
});

test("ambiguous logout failure hides tenant data and allows safe retry or return", async ({ page }) => {
  let logoutCalls = 0;
  await mockAuthenticatedWorkspace(page);
  await routeLogout(page, async (route) => {
    logoutCalls += 1;
    if (logoutCalls === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 204,
      headers: {
        ...corsHeaders,
        "set-cookie": "techbaza_refresh=; Path=/api/v1/auth/browser; Max-Age=0; HttpOnly; SameSite=Strict",
      },
      body: "",
    });
  });

  await page.goto("/devices");
  await openUserMenuAndLogout(page);

  await expect(page.getByRole("heading", { name: "Не вдалося завершити сесію" })).toBeVisible();
  await expect(page.getByText(/server-side session ще не вважається відкликаною/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();

  await page.getByRole("button", { name: "Повернутися до кабінету" }).click();
  await expect(page.getByRole("heading", { name: "Пристрої" })).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();

  await openUserMenuAndLogout(page);
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByText("Сесію завершено")).toBeVisible();
  expect(logoutCalls).toBe(2);
});

test("logout rate limit respects Retry-After before allowing another attempt", async ({ page }) => {
  let logoutCalls = 0;
  await mockAuthenticatedWorkspace(page);
  await routeLogout(page, async (route) => {
    logoutCalls += 1;
    if (logoutCalls === 1) {
      await route.fulfill({
        status: 429,
        headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "3" },
        body: JSON.stringify({ detail: "Забагато auth-спроб" }),
      });
      return;
    }
    await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
  });

  await page.goto("/devices");
  await openUserMenuAndLogout(page);

  const retry = page.getByRole("button", { name: /Повторити/u });
  await expect(retry).toBeDisabled({ timeout: 1_000 });
  await expect(retry).toContainText(/через [1-3] с/u);
  await expect(retry).toBeEnabled({ timeout: 5_000 });
  await retry.click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  expect(logoutCalls).toBe(2);
});
