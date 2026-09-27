import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const API_ORIGIN = "http://127.0.0.1:8001";
const FRONTEND_ORIGIN = "http://127.0.0.1:3000";
const LOGIN_URL = `${API_ORIGIN}/api/v1/auth/browser/login`;
const REFRESH_URL = `${API_ORIGIN}/api/v1/auth/browser/refresh`;

const corsHeaders = {
  "access-control-allow-origin": FRONTEND_ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-techbaza-csrf",
  vary: "Origin",
};

function tokenPayload(seed: string) {
  return {
    access_token: `header.${seed.repeat(80)}.signature`,
    token_type: "bearer",
    expires_in: 900,
    session_expires_in: 2_592_000,
  } as const;
}

async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: corsHeaders });
  return true;
}

async function routeLogin(page: Page, onSuccess: () => void) {
  await page.route(LOGIN_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    onSuccess();
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "set-cookie": `techbaza_refresh=${"r".repeat(64)}; Path=/api/v1/auth/browser; HttpOnly; SameSite=Strict`,
      },
      body: JSON.stringify(tokenPayload("l")),
    });
  });
}

async function routeRefresh(
  target: Page | BrowserContext,
  handler: (route: Route) => Promise<void>,
) {
  await target.route(REFRESH_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await handler(route);
  });
}

test("reload restores access from the HttpOnly refresh cookie exactly once", async ({ page }) => {
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
  await routeLogin(page, () => { refreshAvailable = true; });

  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Пароль").fill("valid-test-password");
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена · demo data")).toBeVisible();

  refreshCalls = 0;
  await page.reload();
  await expect(page.getByText("Сесія відновлена · demo data")).toBeVisible();
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

test("two tabs share one coordinated refresh instead of racing token rotation", async ({ context, page }) => {
  await page.close();
  let refreshCalls = 0;
  let activeRequests = 0;
  let maximumConcurrency = 0;

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
  expect(maximumConcurrency).toBe(1);
  expect(refreshCalls).toBe(1);
});

test("a valid refresh cookie redirects the login page without asking for the password again", async ({ page }) => {
  await routeRefresh(page, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify(tokenPayload("r")),
    });
  });

  await page.goto("/login");
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія відновлена · demo data")).toBeVisible();
});

test("temporary refresh failure is not presented as a logout", async ({ page }) => {
  await routeRefresh(page, async (route) => route.abort("failed"));

  await page.goto("/devices");
  await expect(page.getByText("Сесію не перевірено · demo data")).toBeVisible();
  await expect(page.getByText("Backend тимчасово недоступний")).toBeVisible();
});
