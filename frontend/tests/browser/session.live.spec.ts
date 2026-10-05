import { expect, test, type Page, type Request } from "@playwright/test";

const API_BASE_URL = process.env.KERUMO_API_BASE_URL ?? "http://127.0.0.1:8001";
const demoEmail = process.env.KERUMO_DEMO_EMAIL;
const demoPassword = process.env.KERUMO_DEMO_PASSWORD;
const REFRESH_URL = `${API_BASE_URL}/api/v1/auth/browser/refresh`;

if (!demoEmail || !demoPassword) {
  throw new Error("KERUMO_DEMO_EMAIL and KERUMO_DEMO_PASSWORD are required for live session tests.");
}

const DEMO_EMAIL: string = demoEmail;
const DEMO_PASSWORD: string = demoPassword;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Логін").fill(DEMO_EMAIL);
  await page.getByLabel("Пароль", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Увійти" }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
}

test("real HttpOnly session restores profile, tenant and permissions after reload", async ({ page }) => {
  await login(page);

  const refreshResponsePromise = page.waitForResponse(
    (response) => response.url() === REFRESH_URL && response.request().method() === "POST",
  );
  const meResponsePromise = page.waitForResponse(
    (response) => response.url() === `${API_BASE_URL}/api/v1/auth/me`
      && response.request().method() === "GET",
  );
  await page.reload();
  const [refreshResponse, meResponse] = await Promise.all([refreshResponsePromise, meResponsePromise]);
  expect(refreshResponse.status()).toBe(200);
  expect(meResponse.status()).toBe(200);

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

  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText(/DEMO: owner · Власник/u)).toBeVisible();

  const accessToken = String(payload.access_token);
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

test("real concurrent tabs serialize refresh rotation and both resolve access context", async ({ page, context }) => {
  await login(page);
  await page.close();

  let refreshRequests = 0;
  const countRefresh = (request: Request) => {
    if (request.url() === REFRESH_URL && request.method() === "POST") refreshRequests += 1;
  };
  context.on("request", countRefresh);

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/devices"), second.goto("/devices")]);

  await expect(first.locator(".app-shell")).toBeVisible();
  await expect(second.locator(".app-shell")).toBeVisible();
  await expect(first.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(second.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(first.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(second.getByText("DEMO: клієнт A").first()).toBeVisible();
  expect(refreshRequests).toBe(1);

  context.off("request", countRefresh);
});
