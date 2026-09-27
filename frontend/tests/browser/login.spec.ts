import { expect, test, type Page, type Route } from "@playwright/test";

const LOGIN_URL = "http://127.0.0.1:8001/api/v1/auth/browser/login";
const FRONTEND_ORIGIN = "http://127.0.0.1:3000";

const corsHeaders = {
  "access-control-allow-origin": FRONTEND_ORIGIN,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-techbaza-csrf",
  vary: "Origin",
};

async function mockBrowserLogin(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route(LOGIN_URL, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    await handler(route);
  });
}

async function fillLogin(page: Page, email = "owner@example.com", password = "valid-test-password") {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
}

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

test("successful login sends CSRF, accepts HttpOnly cookie and keeps access only in memory", async ({ page, context }) => {
  let requestHeaders: Record<string, string> = {};
  let requestBody: unknown = null;
  const refreshToken = "r".repeat(64);
  const accessToken = `header.${"a".repeat(80)}.signature`;

  await mockBrowserLogin(page, async (route) => {
    requestHeaders = route.request().headers();
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "set-cookie": `techbaza_refresh=${refreshToken}; Path=/api/v1/auth/browser; HttpOnly; SameSite=Strict`,
      },
      body: JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 900,
        session_expires_in: 2_592_000,
      }),
    });
  });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена · demo data")).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();

  expect(requestHeaders["x-techbaza-csrf"]).toBe("1");
  expect(requestHeaders.origin).toBe(FRONTEND_ORIGIN);
  expect(requestBody).toEqual({ email: "owner@example.com", password: "valid-test-password" });

  const cookies = await context.cookies("http://127.0.0.1:8001/api/v1/auth/browser/login");
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
