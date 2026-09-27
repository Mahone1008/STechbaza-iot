import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

import {
  REFRESH_URL,
  corsHeaders,
  fillLogin,
  fulfillPreflight,
  mockBrowserLoginSuccess,
  mockIdentity,
  tokenPayload,
} from "./auth-fixtures";

async function routeRefresh(
  target: Page | BrowserContext,
  handler: (route: Route) => Promise<void>,
) {
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await handler(route);
  });
}

test("reload restores profile, organization and access from the HttpOnly session exactly once", async ({ page }) => {
  let refreshAvailable = false;
  let refreshCalls = 0;

  await routeRefresh(page, async (route) => {
    refreshCalls += 1;
    if (!refreshAvailable) {
      await route.fulfill({
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ detail: "Браузерна сесія недійсна або завершилася" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "set-cookie": `techbaza_refresh=${"s".repeat(64)}; Path=/api/v1/auth/browser; HttpOnly; SameSite=Strict`,
      },
      body: JSON.stringify(tokenPayload("f")),
    });
  });
  await mockIdentity(page);
  await mockBrowserLoginSuccess(page, { onRequest: () => { refreshAvailable = true; } });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена · demo data")).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();

  refreshCalls = 0;
  await page.reload();
  await expect(page.getByText("Сесія відновлена · demo data")).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText(/Owner · Власник/u)).toBeVisible();
  expect(refreshCalls).toBe(1);

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual([]);
  expect(storage.visibleCookies).not.toContain("techbaza_refresh");
  expect(JSON.stringify(storage)).not.toContain(tokenPayload("f").access_token);
});

test("two tabs share one coordinated refresh and each resolves its protected access context", async ({ context, page }) => {
  await page.close();
  let refreshCalls = 0;
  let activeRequests = 0;
  let maximumConcurrency = 0;

  await mockIdentity(context);
  await routeRefresh(context, async (route) => {
    refreshCalls += 1;
    activeRequests += 1;
    maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify(tokenPayload("c")),
    });
    activeRequests -= 1;
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/devices"), second.goto("/devices")]);

  await expect(first.getByText("Сесія відновлена · demo data")).toBeVisible();
  await expect(second.getByText("Сесія відновлена · demo data")).toBeVisible();
  await expect(first.getByText("owner@example.com")).toBeVisible();
  await expect(second.getByText("owner@example.com")).toBeVisible();
  expect(maximumConcurrency).toBe(1);
  expect(refreshCalls).toBe(1);
});

test("a valid refresh cookie redirects the login page and then verifies the real access context", async ({ page }) => {
  await routeRefresh(page, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify(tokenPayload("r")),
    });
  });
  await mockIdentity(page);

  await page.goto("/login");
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія відновлена · demo data")).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
});

test("temporary refresh failure never reveals protected tenant data", async ({ page }) => {
  await routeRefresh(page, async (route) => route.abort("failed"));

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Не вдалося перевірити сесію" })).toBeVisible();
  await expect(page.getByText(/Дані кабінету не показуються/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();
  await expect(page.getByText("DEMO: клієнт A")).not.toBeVisible();
});
