import { expect, test, type Response } from "@playwright/test";

const API_BASE_URL = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const DEMO_EMAIL = process.env.KERUMO_DEMO_EMAIL;
const DEMO_PASSWORD = process.env.KERUMO_DEMO_PASSWORD;

if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required for live login tests.");
}

// Зчитуємо тіло під час response event, до UI assertions та наступних переходів.
async function captureJsonResponse(response: Response) {
  return { status: response.status(), body: await response.json() as Record<string, unknown> };
}

test("real browser login resolves /auth/me, organization access and an HttpOnly session", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Логін").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(DEMO_PASSWORD);

  let profileRequests = 0;
  page.on("request", (request) => {
    if (request.url() === `${API_BASE_URL}/api/v1/auth/me` && request.method() === "GET") profileRequests += 1;
  });
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/browser/login`
      && response.request().method() === "POST",
  ).then(captureJsonResponse);
  const meResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/me`
      && response.request().method() === "GET",
  ).then(captureJsonResponse);
  const accessResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/access")
      && response.url().startsWith(`${API_BASE_URL}/api/v1/organizations/`)
      && response.request().method() === "GET",
  ).then(captureJsonResponse);

  await page.getByRole("button", { name: "Увійти" }).click();
  const [loginResponse, meResponse, accessResponse] = await Promise.all([
    loginResponsePromise,
    meResponsePromise,
    accessResponsePromise,
  ]);
  expect(loginResponse.status).toBe(200);
  expect(meResponse.status).toBe(200);
  expect(accessResponse.status).toBe(200);

  const payload = loginResponse.body;
  expect(payload.token_type).toBe("bearer");
  expect(typeof payload.access_token).toBe("string");
  expect(Number(payload.expires_in)).toBeGreaterThan(0);
  expect(Number(payload.session_expires_in)).toBeGreaterThan(0);

  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText("Власник", { exact: true })).toBeVisible();

  const accessToken = String(payload.access_token);
  expect(profileRequests).toBe(1);
  const mePayload = meResponse.body;
  expect(mePayload.email).toBe(DEMO_EMAIL);
  expect(mePayload.is_active).toBe(true);
  expect(typeof mePayload.auth_session_id).toBe("string");
  expect(Array.isArray(mePayload.memberships)).toBe(true);

  const accessPayload = accessResponse.body;
  expect(accessPayload.organization_role).toBe("owner");
  expect(accessPayload.permissions).toEqual(expect.arrayContaining(["device.read", "command.execute"]));

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
  await page.getByLabel("Логін").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(`${DEMO_PASSWORD}-wrong`);

  const loginResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/browser/login`
      && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Увійти" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(401);

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.locator(".login-alert")).toContainText("Невірний логін або пароль");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
});
