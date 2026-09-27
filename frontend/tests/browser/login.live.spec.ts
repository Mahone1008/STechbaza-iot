import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const DEMO_EMAIL = process.env.KERUMO_DEMO_EMAIL;
const DEMO_PASSWORD = process.env.KERUMO_DEMO_PASSWORD;

if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required for live login tests.");
}

test("real browser login creates an HttpOnly session and authenticates the access token", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/browser/login`
      && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Увійти" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);

  const payload = await loginResponse.json() as {
    access_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    session_expires_in?: unknown;
  };
  expect(payload.token_type).toBe("bearer");
  expect(typeof payload.access_token).toBe("string");
  expect(Number(payload.expires_in)).toBeGreaterThan(0);
  expect(Number(payload.session_expires_in)).toBeGreaterThan(0);

  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена · demo data")).toBeVisible();
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();

  const accessToken = String(payload.access_token);
  const meResponse = await page.request.get(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(meResponse.status()).toBe(200);
  const mePayload = await meResponse.json() as { email?: unknown; is_active?: unknown };
  expect(mePayload.email).toBe(DEMO_EMAIL);
  expect(mePayload.is_active).toBe(true);

  const cookies = await context.cookies(`${API_BASE_URL}/api/v1/auth/browser/login`);
  const refreshCookie = cookies.find((cookie) => cookie.name === "techbaza_refresh");
  expect(refreshCookie).toBeDefined();
  expect(refreshCookie).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/v1/auth/browser",
  });

  const browserStorage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(browserStorage.local).toEqual([]);
  expect(browserStorage.session).toEqual([]);
  expect(browserStorage.visibleCookies).not.toContain("techbaza_refresh");
  expect(JSON.stringify(browserStorage)).not.toContain(accessToken);
});

test("real backend rejects a wrong password with the generic login error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(`${DEMO_PASSWORD}-wrong`);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/browser/login`
      && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Увійти" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(401);

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("alert")).toContainText("Невірний email або пароль");
  await expect(page.getByLabel("Пароль")).toHaveValue("");
});
