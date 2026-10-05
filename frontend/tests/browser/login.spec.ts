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
  fulfillJson,
  tokenPayload,
} from "./auth-fixtures";

async function mockBrowserLogin(
  page: Parameters<typeof mockMissingBrowserSession>[0],
  handler: (route: Route) => Promise<void>,
) {
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

  await expect(page.getByText(/логін із комплекту/)).toBeVisible();
  await expect(page.getByText("Введіть пароль.")).toBeVisible();
  expect(postRequests).toBe(0);
});

test("successful login resolves real profile, organization and permissions without persisting tokens", async ({
  page,
  context,
}) => {
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
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("DEMO: клієнт A").first()).toBeVisible();
  await expect(page.getByText("Власник", { exact: true })).toBeVisible();

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
      body: JSON.stringify({ detail: "Невірний логін або пароль" }),
    });
  });

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.locator(".login-alert")).toContainText("Невірний логін або пароль");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("");
});

test("MFA login requests its code without erasing the verified password and then opens home", async ({ page }) => {
  await mockIdentity(page);
  let requests = 0;
  await mockBrowserLogin(page, async (route) => {
    requests += 1;
    if (requests < 3) {
      expect(route.request().postDataJSON()).toEqual({
        email: "owner@example.com",
        password: "valid-test-password",
        ...(requests === 2 ? { otp: "000000" } : {}),
      });
      await fulfillJson(route, 401, {
        detail: { code: requests === 1 ? "mfa_required" : "mfa_invalid", message: "MFA" },
      });
    } else {
      expect(route.request().postDataJSON().otp).toBe("123456");
      await fulfillJson(route, 200, tokenPayload("v"));
    }
  });
  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  const code = page.getByLabel("Код двоетапного входу, якщо ввімкнено", { exact: true });
  await expect(page.locator(".login-alert-info")).toContainText("Підтвердьте двоетапний вхід");
  await expect(code).toBeFocused();
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("valid-test-password");
  expect(requests).toBe(1);
  await code.fill("000000");
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page.locator(".login-alert-danger")).toContainText("Код із застосунку не прийнято");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("valid-test-password");
  await code.fill("123456");
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  expect(requests).toBe(3);
});

for (const seconds of [3, 60])
  test(`rate limit expires its banner after ${seconds}s without replaying login`, async ({ page }) => {
    await page.clock.install();
    let requests = 0;
    await mockBrowserLogin(page, async (route) => {
      requests += 1;
      await route.fulfill({
        status: requests === 1 ? 429 : 401,
        headers: { ...corsHeaders, "content-type": "application/json", "retry-after": String(seconds) },
        body: JSON.stringify({ detail: "Забагато auth-спроб" }),
      });
    });

    await page.goto("/login");
    await fillLogin(page);
    await page.getByRole("button", { name: "Увійти" }).click();

    await expect(page.locator(".login-alert-warning")).toContainText(/Повторіть через/u);
    await expect(page.getByRole("button", { name: /Спробуйте через/u })).toBeDisabled();
    await page.clock.fastForward(1_000);
    await expect(page.locator(".login-alert-warning")).toContainText(`Повторіть через ${seconds - 1} с.`);
    await page.reload();
    await expect(page.locator(".login-alert-warning")).toContainText(`Повторіть через ${seconds - 1} с.`);
    await expect(page.getByRole("button", { name: /Спробуйте через/u })).toBeDisabled();
    expect(requests).toBe(1);
    const stored = await page.evaluate(() => Object.entries(localStorage));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toContain("kerumo.login-cooldown:");
    expect(stored[0]?.[1]).toMatch(/^\d+$/);
    await page.clock.fastForward(seconds * 1_000);
    await expect(page.locator(".login-alert-warning, .login-alert-danger")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Увійти", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([]);
    expect(requests).toBe(1);
    await fillLogin(page);
    await page.getByRole("button", { name: "Увійти", exact: true }).click();
    await expect(page.locator(".login-alert-danger")).toContainText("Невірний логін або пароль.");
    await page.clock.fastForward(1_000);
    await expect(page.locator(".login-alert-danger")).toBeVisible();
    expect(requests).toBe(2);
  });

test("login cooldown is shared with another open tab and cleared there at expiry", async ({ page, context }) => {
  const other = await context.newPage();
  await mockMissingBrowserSession(other);
  await page.clock.install();
  let requests = 0;
  await mockBrowserLogin(page, async (route) => {
    requests += 1;
    await route.fulfill({
      status: 429,
      headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "60" },
      body: JSON.stringify({ detail: "Забагато auth-спроб" }),
    });
  });
  await page.goto("/login");
  await other.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(other.locator(".login-alert-warning")).toBeVisible();
  await expect(other.getByRole("button", { name: /Спробуйте через/u })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(other.locator(".login-alert-warning")).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Увійти", exact: true })).toBeEnabled();
  expect(requests).toBe(1);
  await other.close();
});

test("password visibility is keyboard accessible and never submits the login form", async ({ page }) => {
  let requests = 0;
  await mockBrowserLogin(page, async (route) => {
    requests += 1;
    await route.abort("failed");
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  const password = page.getByLabel("Пароль", { exact: true });
  await password.fill("visible-test-password");
  await expect(password).toHaveAttribute("type", "password");
  const toggle = page.getByRole("button", { name: "Показати пароль", exact: true });
  await expect(toggle).toHaveAccessibleDescription("Пароль");
  await toggle.focus();
  await toggle.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("visible-test-password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("button", { name: "Приховати пароль", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Приховати пароль", exact: true }).press("Space");
  await expect(password).toHaveAttribute("type", "password");
  expect(requests).toBe(0);
});

for (const width of [320, 1440])
  test(`password eye stays inside the input border while hovered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/login");
    const field = page.getByLabel("Пароль", { exact: true });
    const eye = page.getByRole("button", { name: "Показати пароль", exact: true });
    await eye.hover();
    const inputBox = (await field.boundingBox())!,
      eyeBox = (await eye.boundingBox())!;
    expect(eyeBox.x).toBeGreaterThan(inputBox.x);
    expect(eyeBox.y).toBeGreaterThanOrEqual(inputBox.y + 2);
    expect(eyeBox.x + eyeBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width - 2);
    expect(eyeBox.y + eyeBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height - 2);
    await eye.focus();
    await page.screenshot({ path: test.info().outputPath(`password-eye-${width}.png`) });
  });

test("network failure is not rendered as invalid credentials or an empty state", async ({ page }) => {
  await mockBrowserLogin(page, async (route) => route.abort("failed"));

  await page.goto("/login");
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти" }).click();

  await expect(page.locator(".login-alert")).toContainText("Не вдалося підключитися");
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveValue("valid-test-password");
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
      if (request.url() === ME_URL && request.method() === "GET")
        profileFailures.push(request.failure()?.errorText ?? "failed");
    });
    let releaseNavigation = () => {};
    const navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    let destinationRequests = 0;
    // Повільна RSC-відповідь залишає authenticated користувача на /login.
    await page.route(`${FRONTEND_ORIGIN}/devices?*`, async (route) => {
      if (route.request().headers().rsc !== "1") {
        await route.continue();
        return;
      }
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
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      await expect(page).toHaveURL(/\/login$/u);
      expect(profilePaths).toEqual([]);
      await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toHaveCount(0);
      releaseNavigation();
      await expect(page.getByRole("heading", { name: "Пристрої", exact: true })).toBeVisible();
      await expect(page.getByText("На зв’язку", { exact: true })).toBeVisible();
      expect(profilePaths).toEqual(["/devices"]);
      expect(profileFailures).toEqual([]);
    } finally {
      releaseNavigation();
    }
  });
}
