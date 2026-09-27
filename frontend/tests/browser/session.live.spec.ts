import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const DEMO_EMAIL = process.env.KERUMO_DEMO_EMAIL;
const DEMO_PASSWORD = process.env.KERUMO_DEMO_PASSWORD;
const REFRESH_URL = `${API_BASE_URL}/api/v1/auth/browser/refresh`;

if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required for live session tests.");
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.getByText("Сесія підтверджена · demo data")).toBeVisible();
}

test("real HttpOnly session is restored after reload and issues a usable access token", async ({ page }) => {
  await login(page);

  const refreshResponsePromise = page.waitForResponse(
    (response) => response.url() === REFRESH_URL && response.request().method() === "POST",
  );
  await page.reload();
  const refreshResponse = await refreshResponsePromise;
  expect(refreshResponse.status()).toBe(200);

  const payload = await refreshResponse.json() as {
    access_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    session_expires_in?: unknown;
  };
  expect(payload.token_type).toBe("bearer");
  expect(typeof payload.access_token).toBe("string");
  expect(Number(payload.expires_in)).toBeGreaterThan(0);
  expect(Number(payload.session_expires_in)).toBeGreaterThan(0);

  await expect(page.getByText("Сесія відновлена · demo data")).toBeVisible();

  const accessToken = String(payload.access_token);
  const meResponse = await page.request.get(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(meResponse.status()).toBe(200);
  const mePayload = await meResponse.json() as { email?: unknown; is_active?: unknown };
  expect(mePayload.email).toBe(DEMO_EMAIL);
  expect(mePayload.is_active).toBe(true);

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookies: document.cookie,
  }));
  expect(storage.local).toEqual([]);
  expect(storage.session).toEqual([]);
  expect(storage.visibleCookies).not.toContain("techbaza_refresh");
  expect(JSON.stringify(storage)).not.toContain(accessToken);
});

test("real concurrent tabs serialize refresh rotation and both recover", async ({ page, context }) => {
  await login(page);
  await page.close();

  let refreshRequests = 0;
  const countRefresh = (request: import("@playwright/test").Request) => {
    if (request.url() === REFRESH_URL && request.method() === "POST") refreshRequests += 1;
  };
  context.on("request", countRefresh);

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/devices"), second.goto("/devices")]);

  await expect(first.getByText("Сесія відновлена · demo data")).toBeVisible();
  await expect(second.getByText("Сесія відновлена · demo data")).toBeVisible();
  expect(refreshRequests).toBe(1);

  context.off("request", countRefresh);
});
