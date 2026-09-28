import { expect, test, type Route } from "@playwright/test";

import {
  API_ORIGIN,
  FRONTEND_ORIGIN,
  LOGIN_URL,
  ME_URL,
  corsHeaders,
  fillLogin,
  fulfillPreflight,
  mockBrowserLoginSuccess,
  mockIdentity,
  mockMissingBrowserSession,
  mockRefreshSuccess,
} from "./auth-fixtures";

async function mockBrowserLogin(page: Parameters<typeof mockMissingBrowserSession>[0], handler: (route: Route) => Promise<void>) {
  await page.route(LOGIN_URL, async (route) => {
    if (await fulfillPreflight(route)) return;
    await handler(route);
  });
}

test.beforeEach(async ({ page }) => mockMissingBrowserSession(page));

test("client validation blocks malformed credentials before the API call", async ({ page }) => {
  let postRequests = 0;
  await mockBrowserLogin(page, async (route) => {
    postRequests += 1;
    await route.abort("failed");
  });

  await page.goto("/login");
  await fillLogin(page, "not-an-email", "");
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page.getByText(/коректний email/)).toBeVisible();
  await expect(page.getByText("Введіть пароль.")).toBeVisible();
  expect(postRequests).toBe(0);
});

test("successful login resolves real profile, organization and permissions without persisting tokens", async ({ page, context }) => {
  let requestHeaders: Record<string, string> = {};
  let requestBody: unknown = null;
  const refreshToken = "r".repeat(64);
  const accessToken = `header.${"a".repeat(80)}.signature`;

  await mockIdentity(page, { email: "owner@example.com", displayName: "Owner" });
  await mockBrowserLoginSuccess(page, {
    seed: "a",
    onRequest: (route) => {
      requestHeaders = route.request().headers();
      requestBody = route.request().postDataJSON();
    },
  });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена")).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText(/Owner · Власник/u)).toBeVisible();

  expect(requestHeaders["x-techbaza-csrf"]).toBe("1");
  expect(requestHeaders.origin).toBe(FRONTEND_ORIGIN);
  expect(requestBody).toEqual({ email: "owner@example.com", password: "valid-test-password" });

  const cookies = await context.cookies(`${API_ORIGIN}/api/v1/auth/browser/login`);
  const refreshCookie = cookies.find((cookie) => cookie.name === "techbaza_refresh");
  expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/v1/auth/browser" });

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual([]);
  expect(storage.visibleCookies).not.toContain(refreshToken);
  expect(JSON.stringify(storage)).not.toContain(accessToken);
});

test("invalid credentials stay on login and do not disclose account existence", async ({ page }) => {
  await mockBrowserLogin(page, async (route) => {
    await route.fulfill({
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ detail: "Невірний email або пароль" }),
    });
  });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.locator(".login-alert")).toContainText("Невірний email або пароль");
  await expect(page.getByLabel("Пароль")).toHaveValue("");
});

test("rate limit disables repeat login for Retry-After duration", async ({ page }) => {
  await mockBrowserLogin(page, async (route) => {
    await route.fulfill({
      status: 429,
      headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "3" },
      body: JSON.stringify({ detail: "Забагато auth-спроб" }),
    });
  });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page.locator(".login-alert")).toContainText(/Повторіть через [123] с/u);
  await expect(page.getByRole("button", { name: /Спробуйте через/u })).toBeDisabled();
});

test("network failure is not rendered as invalid credentials or an empty state", async ({ page }) => {
  await mockBrowserLogin(page, async (route) => route.abort("failed"));

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page.locator(".login-alert")).toContainText("Backend недоступний");
  await expect(page.getByLabel("Пароль")).toHaveValue("valid-test-password");
});


for (const source of ["login", "refresh"] as const) {
  test(`${source} waits for the workspace route before requesting profile and does not abort it`, async ({ page }) => {
    await mockIdentity(page);
    if (source === "login") await mockBrowserLoginSuccess(page);
    else await mockRefreshSuccess(page);
    const profilePaths: string[] = [];
    const profileFailures: string[] = [];
    await page.route(ME_URL, async (route) => {
      if (await fulfillPreflight(route)) return;
      profilePaths.push(new URL(page.url()).pathname);
      await route.fallback();
    });
    page.on("requestfailed", (request) => {
      if (request.url() === ME_URL && request.method() === "GET") profileFailures.push(request.failure()?.errorText ?? "failed");
    });
    let releaseNavigation = () => {};
    const navigationGate = new Promise<void>((resolve) => { releaseNavigation = resolve; });
    let destinationRequests = 0;
    // Повільна RSC-відповідь залишає authenticated користувача на /login.
    await page.route(`${FRONTEND_ORIGIN}/devices?*`, async (route) => {
      if (route.request().headers().rsc !== "1") { await route.continue(); return; }
      destinationRequests += 1;
      await navigationGate;
      await route.continue();
    });
    try {
      await page.goto("/login");
      if (source === "login") {
        await fillLogin(page);
        await page.getByRole("button", { name: "Увійти" }).click();
      }
      await expect.poll(() => destinationRequests).toBeGreaterThan(0);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page).toHaveURL(/\/login$/u);
      expect(profilePaths).toEqual([]);
      await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toHaveCount(0);
      releaseNavigation();
      await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toBeVisible();
      await expect(page.getByText("Online", { exact: true })).toBeVisible();
      expect(profilePaths).toEqual(["/devices"]);
      expect(profileFailures).toEqual([]);
    } finally { releaseNavigation(); }
  });
}
