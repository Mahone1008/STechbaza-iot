import { expect, test, type Page, type Route } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";
import {
  API_ORIGIN,
  DEVICE_ID,
  SESSION_ID,
  SITE_ID,
  corsHeaders,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
  mockMissingBrowserSession,
  fillLogin,
  mockBrowserLoginSuccess,
} from "./auth-fixtures";

type Schema = components["schemas"];
const id = "017ca46d-342c-4ab6-bd1c-89a602021951";
const recovery = "r".repeat(43),
  activation = "a".repeat(43),
  password = "browser-fixture-only-123";
const connection: Schema["ConnectionRead"] = {
  activation_required: true,
  permanent_login: null,
  controller_id: id,
  serial_number: "BROWSER-001",
  hardware_model: "KERUMO V3",
  state: "ready",
  device_id: null,
  site_id: null,
  last_contact_at: null,
  firmware_version: null,
};
const controller: Schema["FactoryRead"] = {
  access_revoked: false,
  credential_revision: 0,
  id,
  serial_number: connection.serial_number,
  hardware_model: connection.hardware_model,
  hardware_revision: "3.1",
  batch: "test",
  status: "ready",
  generation: 1,
  distributor: null,
  claimed_at: null,
  device_id: null,
  last_contact_at: null,
};
const profile: Schema["ProfileRead"] = {
  id: "sunfar.su300",
  version: 1,
  manufacturer: "Sunfar",
  series: "SU300",
  support: "documented",
  driver_id: null,
  driver_version: null,
  command_protocol: null,
  tested_model: null,
  manual: "test manual",
  manual_pages: [1],
  manual_sha256: "a".repeat(64),
  profile_hash: "b".repeat(64),
  notes: [],
  parameter_family: "SU300",
};
async function route(page: Page, path: string, handle: (route: Route) => Promise<void>) {
  await page.route(`${API_ORIGIN}/api/v1/${path}`, async (request) => {
    if (!(await fulfillPreflight(request))) await handle(request);
  });
}
async function read(page: Page, path: string, data: () => unknown) {
  await route(page, path, (request) => fulfillJson(request, 200, data()));
}
async function noStoredSecrets(page: Page, ...secrets: string[]) {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of secrets) {
    expect(stored).not.toContain(secret);
    expect(page.url()).not.toContain(secret);
  }
}

test("QR activation uses the label password without registration and resumes its wizard", async ({ page }) => {
  await mockMissingBrowserSession(page);
  let posts = 0;
  await route(page, "auth/browser/login", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({ controller_id: id, password });
    if (posts === 1) {
      await fulfillJson(request, 401, { detail: "Невірний логін або пароль." });
      return;
    }
    await mockAuthenticatedWorkspace(page);
    await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false }));
    await read(page, "connect/sites", () => []);
    await read(page, "equipment/profiles", () => [profile]);
    await fulfillJson(request, 200, {
      access_token: "activation-access-token-only-for-browser-test",
      token_type: "bearer",
      expires_in: 300,
      session_expires_in: 3600,
      onboarding_path: `/connect/${id}`,
    });
  });
  await page.goto(`/connect/${id}`);
  await expect(page.getByRole("link", { name: "Створити обліковий запис", exact: true })).toHaveCount(0);
  await page.getByLabel("Пароль з етикетки", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Невірний логін або пароль.");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
  await expect(page.getByLabel("Назва об’єкта", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Пароль активації з етикетки", { exact: true })).toHaveCount(0);
  expect(posts).toBe(2);
  await noStoredSecrets(page, password);
});

for (const query of ["", "?returnTo=%2Faccount%2Fsecurity"])
  test(`printed login opens its pending wizard with return query '${query}'`, async ({ page }) => {
    await mockMissingBrowserSession(page);
    const login = "kr-017ca46d342c4ab6bd1c89a602021951-g1";
    await route(page, "auth/browser/login", async (request) => {
      expect(request.request().postDataJSON()).toEqual({ email: login, password });
      await mockAuthenticatedWorkspace(page);
      await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false }));
      await read(page, "connect/sites", () => []);
      await read(page, "equipment/profiles", () => [profile]);
      await fulfillJson(request, 200, {
        access_token: "label-login-access-token-only-for-browser-test",
        token_type: "bearer",
        expires_in: 300,
        session_expires_in: 3600,
        onboarding_path: `/connect/${id}`,
      });
    });
    await page.goto(`/login${query}`);
    await page.getByLabel("Логін", { exact: true }).fill(login);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Увійти", exact: true }).click();
    await expect(page).toHaveURL(`/connect/${id}`);
    await expect(page.getByLabel("Назва об’єкта", { exact: true })).toBeVisible();
    await noStoredSecrets(page, password);
  });

test("ending the current security session returns a normal login to the device home", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await read(page, "auth/security", () => ({
    mfa_enabled: true,
    privileged_mfa_required: false,
    current_session_verified: true,
    recovery_available: true,
  }));
  await read(page, "auth/sessions", () => [
    {
      id: SESSION_ID,
      current: true,
      created_at: new Date().toISOString(),
      expires_at: "2027-01-01T00:00:00Z",
      last_used_at: null,
    },
  ]);
  await route(page, "auth/browser/logout", async (request) =>
    request.fulfill({ status: 204, headers: corsHeaders, body: "" }),
  );
  await mockBrowserLoginSuccess(page);
  await page.goto("/account/security");
  await expect(page.getByText("Двоетапний вхід увімкнено", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Поточний пароль для підтвердження", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Код із застосунку автентифікації", { exact: true })).toHaveCount(0);
  await page
    .getByRole("listitem")
    .filter({ hasText: "Поточна сесія" })
    .getByRole("button", { name: "Завершити сесію", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1$/u);
  await fillLogin(page);
  await page.getByRole("button", { name: "Увійти", exact: true }).click();
  await expect(page).toHaveURL(/\/devices$/u);
  await expect(page.locator(".password-guidance")).toBeVisible();
});

test("registration route is removed", async ({ page }) => {
  await mockMissingBrowserSession(page);
  const response = await page.goto("/register");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Зареєструватися", exact: true })).toHaveCount(0);
});

test("recovery failure is not retried and explicit retry displays a replacement key", async ({ page }) => {
  await mockMissingBrowserSession(page);
  let posts = 0;
  await route(page, "auth/recover", async (request) => {
    posts++;
    expect(request.request().postDataJSON()).toEqual({
      email: "buyer@example.com",
      recovery_key: activation,
      new_password: password,
    });
    await fulfillJson(
      request,
      posts === 1 ? 503 : 200,
      posts === 1 ? { detail: "Unavailable" } : { recovery_key: recovery },
    );
  });
  await page.goto("/recover");
  await page.getByLabel("Логін", { exact: true }).fill("buyer@example.com");
  await page.getByLabel("Ключ відновлення", { exact: true }).fill(activation);
  await page.getByLabel("Новий пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторіть пароль", { exact: true }).fill(password);
  const submit = page.getByRole("button", { name: "Відновити доступ", exact: true });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(60_000);
  expect(posts).toBe(1);
  await submit.click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  expect(posts).toBe(2);
  await noStoredSecrets(page, password, activation, recovery);
});

test("TOTP enrollment clears its secret, rotates recovery and revokes only the selected session", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let mfa = false,
    deleted = false;
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    other = "7d80edec-3b7f-47f2-8a4e-1106231f9ee9";
  await read(page, "auth/security", () => ({
    mfa_enabled: mfa,
    privileged_mfa_required: true,
    current_session_verified: mfa,
    recovery_available: true,
  }));
  await read(page, "auth/sessions", () =>
    (deleted ? [SESSION_ID] : [SESSION_ID, other]).map((id) => ({
      id,
      current: id === SESSION_ID,
      created_at: new Date().toISOString(),
      expires_at: "2027-01-01T00:00:00Z",
      last_used_at: null,
    })),
  );
  await route(page, "auth/security/totp/setup", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ password });
    await fulfillJson(request, 200, { secret, uri: `otpauth://totp/test?secret=${secret}` });
  });
  await route(page, "auth/security/totp/confirm", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ otp: "123456" });
    mfa = true;
    await request.fulfill({ status: 204, headers: corsHeaders, body: "" });
  });
  await route(page, "auth/security/recovery", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ password, otp: "654321" });
    await fulfillJson(request, 200, { recovery_key: recovery });
  });
  await route(page, `auth/sessions/${other}`, async (request) => {
    expect(request.request().method()).toBe("DELETE");
    deleted = true;
    await fulfillJson(request, 200, {});
  });
  await page.goto("/account/security");
  const proof = page.getByLabel("Поточний пароль для підтвердження", { exact: true });
  const otp = page.getByLabel("Код із застосунку автентифікації", { exact: true });
  await expect(otp).toHaveCount(0);
  await proof.fill(password);
  await page.getByRole("button", { name: "Налаштувати двоетапний вхід", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(secret);
  await expect(page.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toBeVisible();
  await expect(proof).toHaveCount(0);
  await otp.fill("123456");
  await page.getByRole("button", { name: "Підтвердити код і ввімкнути", exact: true }).click();
  await expect(page.getByText("Двоетапний вхід увімкнено", { exact: true })).toBeVisible();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
  await expect(otp).toHaveCount(0);
  const totpCard = page
    .locator(".account-security-card")
    .filter({ has: page.getByRole("heading", { name: "Двоетапний вхід", exact: true }) });
  await expect(totpCard.getByRole("textbox")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: test.info().outputPath("mfa-enabled-mobile.png") });
  await page.getByLabel("Поточний пароль для оновлення ключа", { exact: true }).fill(password);
  await page.getByLabel("Код із застосунку для оновлення ключа", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Створити новий ключ відновлення", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  await page.getByRole("button", { name: "Я зберіг ключ", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
  await page.getByRole("listitem").filter({ hasText: "Інша сесія" }).getByRole("button").click();
  await expect(page.getByText("Інша сесія", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Поточна сесія", { exact: true })).toBeVisible();
  expect(deleted).toBe(true);
  await noStoredSecrets(page, secret, password, recovery);
});

for (const width of [320, 1440])
  test(`password settings keep separate controls and readable spacing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAuthenticatedWorkspace(page);
    const mfaEnabled = width === 1440;
    await read(page, "auth/security", () => ({
      mfa_enabled: mfaEnabled,
      privileged_mfa_required: false,
      current_session_verified: false,
      recovery_available: true,
    }));
    await read(page, "auth/sessions", () => []);
    let changes = 0;
    await route(page, "auth/security/password", async (request) => {
      changes += 1;
      expect(request.request().postDataJSON()).toEqual({
        password,
        otp: mfaEnabled ? "987654" : null,
        new_password: "new-browser-password-123",
      });
      await request.fulfill({ status: 204, headers: corsHeaders, body: "" });
    });
    await page.goto("/account/security");
    await page.getByLabel("Поточний пароль для зміни пароля", { exact: true }).fill(password);
    if (mfaEnabled) {
      await page.getByLabel("Код із застосунку для зміни пароля", { exact: true }).fill("987654");
    }
    const card = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Постійний пароль", exact: true }) });
    const input = card.getByLabel("Повторіть новий пароль", { exact: true });
    await card.getByLabel("Новий пароль", { exact: true }).fill("new-browser-password-123");
    await input.fill("new-browser-password-123");
    const field = card.locator(".field").filter({ has: page.getByLabel("Повторіть новий пароль", { exact: true }) });
    await field.getByRole("button", { name: "Показати пароль", exact: true }).click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(card.getByLabel("Новий пароль", { exact: true })).toHaveAttribute("type", "password");
    await field.getByRole("button", { name: "Приховати пароль", exact: true }).click();
    await input.focus();
    const button = card.getByRole("button", { name: "Змінити пароль", exact: true });
    await expect(button).toBeEnabled();
    const inputBox = (await input.boundingBox())!,
      buttonBox = (await button.boundingBox())!;
    expect(buttonBox.y - (inputBox.y + inputBox.height)).toBeGreaterThanOrEqual(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`security-${width}.png`), fullPage: true });
    expect(changes).toBe(0);
    await button.click();
    await expect(input).toHaveValue("");
    await expect(card.getByLabel("Поточний пароль для зміни пароля", { exact: true })).toHaveValue("");
    if (mfaEnabled) {
      await expect(card.getByLabel("Код із застосунку для зміни пароля", { exact: true })).toHaveValue("");
    }
    expect(changes).toBe(1);
  });

for (const failure of [
  { status: 401, detail: "Код не підтверджено" },
  { status: 503, detail: "Перевірка двоетапного входу тимчасово недоступна" },
]) {
  test(`TOTP confirmation ${failure.status} focuses an inline error and a fresh code opens the factory`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
    let mfa = false,
      posts = 0;
    let finishConfirmation = () => {};
    const confirmation = new Promise<void>((resolve) => {
      finishConfirmation = resolve;
    });
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    await read(page, "auth/security", () => ({
      mfa_enabled: mfa,
      privileged_mfa_required: true,
      current_session_verified: mfa,
      recovery_available: false,
    }));
    await read(page, "auth/sessions", () => []);
    await route(page, "auth/security/totp/setup", (request) =>
      fulfillJson(request, 200, { secret, uri: `otpauth://totp/test?secret=${secret}` }),
    );
    await route(page, "auth/security/totp/confirm", async (request) => {
      posts++;
      if (posts === 1) {
        expect(request.request().postDataJSON()).toEqual({ otp: "000000" });
        await fulfillJson(request, failure.status, { detail: failure.detail });
        return;
      }
      expect(request.request().postDataJSON()).toEqual({ otp: "123456" });
      await confirmation;
      mfa = true;
      await request.fulfill({ status: 204, headers: corsHeaders, body: "" });
    });
    await read(page, "factory/controllers?*", () => []);
    await page.goto("/account/security");
    const card = page
      .locator(".card")
      .filter({ has: page.getByRole("heading", { name: "Двоетапний вхід", exact: true }) });
    await page.getByLabel("Поточний пароль для підтвердження", { exact: true }).fill(password);
    await card.getByRole("button", { name: "Налаштувати двоетапний вхід", exact: true }).click();
    await expect(card.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toBeVisible();
    const otp = page.getByLabel("Код із застосунку автентифікації", { exact: true });
    await otp.fill("000000");
    await card.getByRole("button", { name: "Підтвердити код і ввімкнути", exact: true }).click();
    const error = card.getByRole("alert");
    await expect(error).toHaveText(failure.status === 503 ? "Сервіс тимчасово недоступний. Спробуйте пізніше." : failure.detail);
    await expect(error).toBeFocused();
    await expect(error).toBeInViewport();
    await expect(card.locator(".recovery-key")).toHaveText(secret);
    await expect(card.getByText("Двоетапний вхід увімкнено", { exact: true })).toHaveCount(0);
    expect(posts).toBe(1);
    await otp.fill("123456");
    await card.getByRole("button", { name: "Підтвердити код і ввімкнути", exact: true }).click();
    await expect(card.getByRole("button", { name: "Підтверджуємо код…", exact: true })).toBeDisabled();
    finishConfirmation();
    await expect(card.getByText("Двоетапний вхід увімкнено", { exact: true })).toBeVisible();
    await expect(card.locator(".notice-success")).toBeFocused();
    await expect(card.getByRole("textbox")).toHaveCount(0);
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(card.locator(".recovery-key")).toHaveCount(0);
    await expect(card.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toHaveCount(0);
    expect(posts).toBe(2);
    await card.getByRole("link", { name: "Відкрити заводський реєстр", exact: true }).click();
    await expect(page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true })).toBeVisible();
    await noStoredSecrets(page, secret, password);
  });
}

test("factory denial hides issuance and shipment controls", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await route(page, "factory/controllers?*", (request) => fulfillJson(request, 403, { detail: "Forbidden" }));
  await page.goto("/factory");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Записати постачання", exact: true })).toHaveCount(0);
});

test("factory requires a passed test, issues one kit and records a shipment", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let posts = 0,
    distributor: string | null = null;
  const kit: Schema["FactorySecrets"] = {
    controller,
    qr_path: `/connect/${id}`,
    activation_code: activation,
    login: "kr-017ca46d342c4ab6bd1c89a602021951-g1",
    password: activation,
    bootstrap_key: "b".repeat(43),
    setup_password: "local-test-password-only",
  };
  await route(page, "factory/controllers*", async (request) => {
    if (request.request().method() === "POST") {
      expect(request.request().postDataJSON().factory_test_passed).toBe(true);
      posts++;
      await fulfillJson(request, 201, kit);
    } else await fulfillJson(request, 200, posts ? [{ ...controller, distributor }] : []);
  });
  await route(page, `factory/controllers/${id}/shipments`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({ distributor: "Test distributor", reference: "INV-001" });
    distributor = "Test distributor";
    await fulfillJson(request, 200, { ...controller, distributor });
  });
  await page.goto("/factory");
  for (const [label, value] of [
    ["Серійний номер", controller.serial_number],
    ["Апаратна ревізія", "3.1"],
    ["Партія", "test"],
    ["Номер протоколу заводської перевірки", "test-001"],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  const issue = page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true });
  await expect(issue).toBeDisabled();
  await page.getByRole("checkbox").check();
  await issue.click();
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await page.getByRole("button", { name: "Друкувати публічний QR", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".factory-public-label")).toBeVisible();
  await expect(page.locator(".factory-private-label")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Друкувати закриту етикетку покупця", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".factory-public-label")).toBeHidden();
  await expect(page.locator(".factory-private-label")).toBeVisible();
  await expect(page.locator(".factory-private-label")).toContainText(kit.login);
  await expect(page.locator(".factory-private-label")).toContainText(kit.password);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.bootstrap_key);
  await page.emulateMedia({ media: "screen" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Завантажити/ }).click();
  expect((await download).suggestedFilename()).toBe("factory-BROWSER-001.json");
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Комплект збережено", exact: true }).click();
  await expect(page.getByRole("button", { name: /Завантажити/ })).toHaveCount(0);
  await page.getByLabel("Оптовик або отримувач партії", { exact: true }).fill("Test distributor");
  await page.getByLabel("Номер документа постачання", { exact: true }).fill("INV-001");
  await page.getByRole("button", { name: "Записати постачання", exact: true }).click();
  await expect(page.locator(".device-events")).toContainText("Test distributor");
  await noStoredSecrets(page, activation, kit.bootstrap_key);
});

for (const existing of [false, true])
  test(`QR claim uses ${existing ? "existing" : "new"} site and records equipment without enabling control`, async ({
    page,
  }) => {
    await mockAuthenticatedWorkspace(page);
    await read(page, `connect/${id}`, () => connection);
    await read(page, "connect/sites", () => [{ id: SITE_ID, name: "Existing site" }]);
    await read(page, "equipment/profiles", () => [profile]);
    let claims = 0,
      writes = 0;
    await route(page, `connect/${id}/claim`, async (request) => {
      claims++;
      expect(request.request().postDataJSON()).toEqual({
        activation_code: activation,
        device_name: "Контролер насоса",
        ...(existing ? { site_id: SITE_ID } : { new_site: { name: "My well", timezone: "Europe/Kyiv" } }),
      });
      await fulfillJson(request, 200, { ...connection, state: "claimed", device_id: DEVICE_ID, site_id: SITE_ID });
    });
    await route(page, `connect/${id}/equipment`, async (request) => {
      expect(request.request().method()).toBe("PUT");
      expect(request.request().postDataJSON()).toEqual({
        profile_id: profile.id,
        profile_version: 1,
        model: "SU300-test",
        hardware_revision: null,
        nameplate_confirmed: true,
      });
      writes++;
      await fulfillJson(request, 200, {});
    });
    await page.goto(`/connect/${id}`);
    if (existing) await page.getByLabel("Куди додати контролер", { exact: true }).selectOption(SITE_ID);
    else await page.getByLabel("Назва об’єкта", { exact: true }).fill("My well");
    await page.getByLabel("Пароль активації з етикетки", { exact: true }).fill(activation);
    await page.getByRole("button", { name: "Підключити до об’єкта", exact: true }).click();
    await expect(
      page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
    ).toBeVisible();
    expect(claims).toBe(1);
    await page.getByLabel("Виробник і серія", { exact: true }).selectOption(`${profile.id}:1`);
    await page.getByLabel("Повна модель зі шильдика", { exact: true }).fill("SU300-test");
    const save = page.getByRole("button", { name: "Зберегти обладнання", exact: true });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/Керування цією моделлю поки недоступне/)).toBeVisible();
    await page.getByRole("checkbox").check();
    await save.click();
    await expect(page.getByText(/Паспорт збережено. Керування не ввімкнено автоматично/)).toBeVisible();
    await expect(save).toBeDisabled();
    expect(writes).toBe(1);
    await noStoredSecrets(page, activation);
  });

test("activation saves permanent credentials and confirms MFA before the factory password expires", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const login = "ku-017ca46d342c4ab6bd1c89a602021951";
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const setup = { login, secret, uri: `otpauth://totp/KERUMO:${login}?secret=${secret}`, recovery_key: recovery };
  await read(page, `connect/${id}`, () => ({ ...connection, activation_required: false, permanent_login: login }));
  await read(page, "connect/sites", () => []);
  await read(page, "equipment/profiles", () => [profile]);
  await route(page, `connect/${id}/security`, async (request) => {
    await fulfillJson(request, 200, setup);
  });
  let permanentPassword = "";
  await route(page, `connect/${id}/claim`, async (request) => {
    const body = request.request().postDataJSON();
    expect(body).toEqual({
      device_name: "Контролер насоса",
      new_site: { name: "New well", timezone: "Europe/Kyiv" },
      new_password: permanentPassword,
      otp: "123456",
    });
    await fulfillJson(request, 200, { ...connection, state: "claimed", device_id: DEVICE_ID, site_id: SITE_ID });
  });
  await page.goto(`/connect/${id}`);
  await page.getByLabel("Назва об’єкта", { exact: true }).fill("New well");
  const submit = page.getByRole("button", { name: "Підключити до об’єкта", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Створити постійний доступ", exact: true }).click();
  permanentPassword = await page.getByLabel("Новий згенерований пароль", { exact: true }).inputValue();
  expect(permanentPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
  const generatedField = page
    .locator(".field")
    .filter({ has: page.getByLabel("Новий згенерований пароль", { exact: true }) });
  await generatedField.getByRole("button", { name: "Показати пароль", exact: true }).click();
  await expect(page.getByLabel("Новий згенерований пароль", { exact: true })).toHaveAttribute("type", "text");
  await generatedField.getByRole("button", { name: "Приховати пароль", exact: true }).click();
  await expect(page.getByLabel("Новий згенерований пароль", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Завантажити дані входу та ключ відновлення", exact: true }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe(`kerumo-access-${login}.json`);
  await page.getByLabel("Я зберіг нові дані входу та ключ відновлення", { exact: true }).check();
  await expect(submit).toBeDisabled();
  await page.getByLabel("Код підтвердження постійного доступу", { exact: true }).fill("123456");
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "Контролер прив’язано" })).toBeVisible();
  await expect(page.getByLabel("Новий згенерований пароль", { exact: true })).toHaveCount(0);
  await noStoredSecrets(page, permanentPassword, secret, recovery);
});
