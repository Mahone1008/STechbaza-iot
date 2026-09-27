import { expect, test, type Page, type Request } from "@playwright/test";

const API_BASE_URL = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const demoEmail = process.env.KERUMO_DEMO_EMAIL;
const demoPassword = process.env.KERUMO_DEMO_PASSWORD;
const LOGIN_URL = `${API_BASE_URL}/api/v1/auth/browser/login`;
const REFRESH_URL = `${API_BASE_URL}/api/v1/auth/browser/refresh`;
const LOGOUT_URL = `${API_BASE_URL}/api/v1/auth/browser/logout`;
const ME_URL = `${API_BASE_URL}/api/v1/auth/me`;

if (!demoEmail || !demoPassword) {
  throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required for live logout tests.");
}

const DEMO_EMAIL: string = demoEmail;
const DEMO_PASSWORD: string = demoPassword;

async function login(page: Page): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  const responsePromise = page.waitForResponse(
    (response) => response.url() === LOGIN_URL && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Увійти" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json() as { access_token?: unknown };
  expect(typeof payload.access_token).toBe("string");
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  return String(payload.access_token);
}

async function clickLogout(page: Page): Promise<void> {
  await page.locator(".sidebar").getByRole("button", { name: "Відкрити меню користувача" }).click();
  await page.getByRole("menuitem", { name: /Вийти з акаунта/u }).click();
}

test("real browser logout revokes the server session, clears the cookie and cannot recover after reload", async ({ page, context, request }) => {
  const accessToken = await login(page);
  const logoutResponsePromise = page.waitForResponse(
    (response) => response.url() === LOGOUT_URL && response.request().method() === "POST",
  );

  await clickLogout(page);
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.status()).toBe(204);
  expect(logoutResponse.request().headers()["x-techbaza-csrf"]).toBe("1");

  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByText("Сесію завершено")).toBeVisible();

  const cookies = await context.cookies(`${API_BASE_URL}/api/v1/auth/browser/logout`);
  expect(cookies.find((cookie) => cookie.name === "techbaza_refresh")).toBeUndefined();

  const revokedAccess = await request.get(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(revokedAccess.status()).toBe(401);

  let refreshCalls = 0;
  const countRefresh = (req: Request) => {
    if (req.url() === REFRESH_URL && req.method() === "POST") refreshCalls += 1;
  };
  page.on("request", countRefresh);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(page.getByRole("heading", { name: "Вхід до кабінету" })).toBeVisible();
  expect(refreshCalls).toBe(0);
  page.off("request", countRefresh);
});

test("real logout in one tab clears peer tabs and a new protected navigation stays anonymous", async ({ page, context }) => {
  await login(page);
  const second = await context.newPage();
  await second.goto("/devices");
  await expect(second.getByText(DEMO_EMAIL)).toBeVisible();

  let logoutCalls = 0;
  const countLogout = (request: Request) => {
    if (request.url() === LOGOUT_URL && request.method() === "POST") logoutCalls += 1;
  };
  context.on("request", countLogout);

  await clickLogout(page);
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(second).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(second.getByText("Сесію завершено")).toBeVisible();
  expect(logoutCalls).toBe(1);

  const third = await context.newPage();
  await third.goto("/devices");
  await expect(third).toHaveURL(/\/login\?loggedOut=1$/u);
  await expect(third.getByRole("heading", { name: "Пристрої" })).not.toBeVisible();

  context.off("request", countLogout);
});
