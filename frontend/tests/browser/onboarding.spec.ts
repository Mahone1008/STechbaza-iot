import {
  securityTotpPassword,
  securityPasswordProof,
  recoveryPasswordProof,
  revealSection,
} from "../helpers/customer-details";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";
import {
  API_ORIGIN,
  DEVICE_ID,
  ORGANIZATION_ID,
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
  can_install: false,
  can_setup: false,
  can_invite_installer: false,
  organization_id: null,
  readiness: { state: "needs_equipment", title: "Активація контролера", next_action: null, blockers: [] },
  network_transport: "wifi",
  connection_state: "not_connected",
  activation_required: true,
  initial_equipment_editable: true,
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
  network_transport: "wifi",
  transport_editable: false,
  prepared_equipment: null,
  preparation_revision: 0,
  preparation_editable: false,
  firmware_control_capability: "read_only",
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
  id: "suswe.su300.modbus",
  version: 1,
  manufacturer: "SUSWE",
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

test("public QR keeps account registration separate from device activation", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await page.goto(`/connect/${id}`);
  await expect(page.getByRole("link", { name: "Створити обліковий запис", exact: true })).toHaveAttribute(
    "href",
    `/register?controller=${id}`,
  );
  await expect(page.getByRole("link", { name: "Увійти", exact: true })).toHaveAttribute(
    "href",
    `/login?returnTo=${encodeURIComponent(`/connect/${id}`)}`,
  );
  await expect(page.getByLabel("Пароль з етикетки", { exact: true })).toHaveCount(0);
});

for (const query of ["", "?returnTo=%2Faccount%2Fsecurity"])
  test(`printed login opens its pending wizard with return query '${query}'`, async ({ page }) => {
    await mockMissingBrowserSession(page);
    const login = "kr-017ca46d342c4ab6bd1c89a602021951-g1";
    await route(page, "auth/browser/login", async (request) => {
      expect(request.request().postDataJSON()).toEqual({ email: login, password });
      await mockAuthenticatedWorkspace(page);
      await read(page, `connect/${id}`, () => ({
        ...connection,
        activation_required: false,
        permanent_login: "ku-017ca46d342c4ab6bd1c89a602021951",
      }));
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
    await expect(page.getByRole("heading", { name: "Створіть особистий обліковий запис", exact: true })).toBeVisible();
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
  await revealSection(page, "Переглянути активні сесії");
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

test("registration requests a verified personal mailbox", async ({ page }) => {
  await mockMissingBrowserSession(page);
  await route(page, "auth/registration/start", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ email: "buyer@example.com", controller_id: null });
    await fulfillJson(request, 202, null);
  });
  const response = await page.goto("/register");
  expect(response?.status()).toBe(200);
  await page.getByLabel("Електронна пошта", { exact: true }).fill("buyer@example.com");
  await page.getByRole("button", { name: "Підтвердити пошту", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("відкрийте лист KERUMO");
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
  const proof = await securityTotpPassword(page);
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
  await (await recoveryPasswordProof(page)).fill(password);
  await page.getByLabel("Код із застосунку для оновлення ключа", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Створити новий ключ відновлення", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveText(recovery);
  await page.getByRole("button", { name: "Я зберіг ключ", exact: true }).click();
  await expect(page.locator(".recovery-key")).toHaveCount(0);
  await page.getByText("Переглянути активні сесії", { exact: true }).click();
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
    await (await securityPasswordProof(page)).fill(password);
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
    await (await securityTotpPassword(page)).fill(password);
    await card.getByRole("button", { name: "Налаштувати двоетапний вхід", exact: true }).click();
    await expect(card.getByRole("img", { name: "QR для застосунку автентифікації", exact: true })).toBeVisible();
    const otp = page.getByLabel("Код із застосунку автентифікації", { exact: true });
    await otp.fill("000000");
    await card.getByRole("button", { name: "Підтвердити код і ввімкнути", exact: true }).click();
    const error = card.getByRole("alert");
    await expect(error).toHaveText(
      failure.status === 503 ? "Сервіс тимчасово недоступний. Спробуйте пізніше." : failure.detail,
    );
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
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.login);
  await expect(page.locator(".factory-private-label").locator("svg, canvas")).toHaveCount(0);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.qr_path);
  await expect(page.locator(".factory-private-label")).toContainText(kit.password);
  await expect(page.locator(".factory-private-label")).toContainText(kit.setup_password);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.bootstrap_key);
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByRole("button", { name: "Комплект збережено", exact: true })).toBeDisabled();
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

test("factory records a real LTE identity and rejects secret parameters in the public QR", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const kit = {
    controller: { ...controller, hardware_model: "KERUMO V4", network_transport: "lte", transport_editable: true },
    qr_path: `/connect/${id}`,
    activation_code: activation,
    login: "legacy-print-login-only",
    password: activation,
    bootstrap_key: "b".repeat(43),
    setup_password: "local-setup-fixture-only",
  };
  let creates = 0;
  await route(page, "factory/controllers*", async (request) => {
    if (request.request().method() === "POST") {
      creates++;
      expect(request.request().postDataJSON()).toMatchObject({
        hardware_model: "KERUMO V4",
        network_transport: "lte",
        factory_test_passed: true,
      });
      await fulfillJson(request, 201, kit);
    } else await fulfillJson(request, 200, creates ? [kit.controller] : []);
  });
  await page.goto("/factory");
  await page.getByLabel("Інтернет контролера", { exact: true }).selectOption("lte");
  await expect(page.getByLabel("Модель контролера", { exact: true })).toHaveValue("KERUMO V4");
  for (const [label, value] of [
    ["Серійний номер", "BROWSER-001"],
    ["Апаратна ревізія", "4.1"],
    ["Партія", "test"],
    ["Номер протоколу заводської перевірки", "lte-test"],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true }).click();
  await expect(page.locator(".factory-public-label svg")).toHaveCount(1);
  await expect(page.locator(".factory-private-label svg")).toHaveCount(0);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.bootstrap_key);
  await expect(page.locator(".factory-private-label")).not.toContainText(kit.login);
  const url = page.getByLabel("Публічне посилання для QR", { exact: true });
  await url.fill(`http://127.0.0.1:3000/connect/${id}?password=must-not-be-in-qr`);
  await expect(page.locator(".factory-public-label svg")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Друкувати публічний QR", exact: true })).toBeDisabled();
  await noStoredSecrets(page, activation, kit.bootstrap_key, kit.setup_password);
});

test("factory transport correction requires physical review and the current generation", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let changed = false;
  await read(page, "factory/controllers?*", () => [
    { ...controller, transport_editable: !changed, network_transport: changed ? "lte" : "wifi" },
  ]);
  await route(page, `factory/controllers/${id}/transport`, async (request) => {
    expect(request.request().method()).toBe("PATCH");
    expect(request.request().postDataJSON()).toEqual({ network_transport: "lte", expected_generation: 1 });
    changed = true;
    await fulfillJson(request, 200, { ...controller, network_transport: "lte", transport_editable: false });
  });
  await page.goto("/factory");
  await page.getByRole("button", { name: "Змінити тип інтернету", exact: true }).click();
  await page.getByLabel("Інтернет · BROWSER-001", { exact: true }).selectOption("lte");
  await expect(page.getByRole("button", { name: "Підтвердити", exact: true })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Тип мережі звірено з модулем і прошивкою цієї плати", exact: true })
    .check();
  await page.getByRole("button", { name: "Підтвердити", exact: true }).click();
  await expect(page.getByRole("button", { name: "Змінити тип інтернету", exact: true })).toHaveCount(0);
});

function readiness(state: string, title: string, nextAction: string | null = null) {
  return { state, title, next_action: nextAction, blockers: [] };
}
const claimedConnection = {
  ...connection,
  state: "claimed",
  device_id: DEVICE_ID,
  site_id: SITE_ID,
  hardware_model: "KERUMO V4",
  network_transport: "lte",
  initial_equipment_editable: false,
  can_install: false,
};

async function expectNoTechnicalSetup(page: Page) {
  await expect(page.getByLabel("Повна модель зі шильдика", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Серія частотника SUSWE", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Номінальна частота двигуна зі шильдика, Гц", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/192\.168\.4\.1|BOOT|RS-485|домашній Wi-Fi/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Перевірити підключення", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Запустити", exact: true })).toHaveCount(0);
}

test("LTE customer readiness updates automatically and never treats bootstrap as ready", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let stage = 0;
  await read(page, `connect/${id}`, () => ({
    ...claimedConnection,
    connection_state: stage === 2 ? "online" : stage === 1 ? "bootstrap_connected" : "not_connected",
    last_contact_transport: stage ? "lte" : null,
    last_contact_at: stage ? "2026-10-12T10:00:00Z" : null,
    telemetry_received_at: stage === 2 ? "2026-10-12T10:00:02Z" : null,
    readiness:
      stage === 2
        ? readiness("ready", "Контролер готовий до використання")
        : readiness("awaiting_controller", "Очікуємо зв’язок із контролером"),
  }));
  await page.goto(`/connect/${id}`);
  await expect(
    page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Очікуємо зв’язок із контролером", { exact: true })).toBeVisible();
  await expectNoTechnicalSetup(page);
  stage = 1;
  await expect(page.getByText("Плата підключилася. Очікуємо показання", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Контролер готовий до використання", { exact: true })).toHaveCount(0);
  await expect(page.locator('.connection-progress li[data-complete="true"]')).toHaveCount(1);
  stage = 2;
  await expect(page.getByText("Контролер готовий до використання", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.connection-progress li[data-complete="true"]')).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Монтаж і перевірка", exact: true })).toHaveCount(0);
  await expectNoTechnicalSetup(page);
  await page.context().setOffline(true);
  await expect(page.getByText("Зв’язок із сайтом перервано", { exact: true })).toBeVisible();
  await expect(page.getByText("Контролер готовий до використання", { exact: true })).toHaveCount(0);
  await page.context().setOffline(false);
  stage = 0;
  await expect(page.getByText("Очікуємо зв’язок із контролером", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Контролер готовий до використання", { exact: true })).toHaveCount(0);
});

test("missing preparation is assigned to the installer without customer equipment writes", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let technicalRequests = 0;
  await route(page, "equipment/profiles", async (request) => {
    technicalRequests++;
    await fulfillJson(request, 200, [profile]);
  });
  await route(page, `devices/${DEVICE_ID}/equipment`, async (request) => {
    technicalRequests++;
    await fulfillJson(request, 200, {});
  });
  await read(page, `connect/${id}`, () => ({
    ...claimedConnection,
    initial_equipment_editable: true,
    readiness: {
      ...readiness("needs_equipment", "Монтажник готує обладнання", "Зверніться до виробника або монтажника."),
      blockers: ["Обладнання ще не підготовлено."],
    },
  }));
  await page.goto(`/connect/${id}`);
  await expect(page.getByText("Монтажник готує обладнання", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Налаштування виконує виробник або монтажник. Вашу активацію вже збережено.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Монтаж і перевірка", exact: true })).toHaveCount(0);
  await expectNoTechnicalSetup(page);
  expect(technicalRequests).toBe(0);
});

test("installer entry follows the server permission instead of owner or editable passport flags", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await read(page, `connect/${id}`, () => ({
    ...claimedConnection,
    can_install: true,
    readiness: readiness("needs_local_confirmation", "Потрібна перевірка монтажником"),
  }));
  await page.goto(`/connect/${id}`);
  await expect(page.getByRole("link", { name: "Монтаж і перевірка", exact: true })).toHaveAttribute(
    "href",
    `/devices/${DEVICE_ID}?view=equipment`,
  );
  await expectNoTechnicalSetup(page);
});

test("owner can invite an installer only to this object with time-limited service access", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await read(page, `connect/${id}`, () => ({
    ...claimedConnection,
    organization_id: ORGANIZATION_ID,
    can_invite_installer: true,
    readiness: readiness("needs_local_confirmation", "Потрібна перевірка монтажником"),
  }));
  let invitations = 0;
  await route(page, `connect/${id}/installer-invitations`, async (request) => {
    invitations++;
    const body = request.request().postDataJSON();
    expect(body).toEqual({
      email: "installer@example.com",
      expires_in_days: 7,
    });
    await fulfillJson(request, 201, {});
  });
  await page.goto(`/connect/${id}`);
  await page.getByText("Запросити монтажника", { exact: true }).click();
  await page.getByLabel("Пошта монтажника", { exact: true }).fill("installer@example.com");
  await page.getByRole("button", { name: "Надіслати запрошення", exact: true }).click();
  await expect(
    page.getByText("Запрошення надіслано. Монтажник має прийняти його протягом трьох днів.", { exact: true }),
  ).toBeVisible();
  expect(invitations).toBe(1);
  await expectNoTechnicalSetup(page);
});

test("an unknown installer email shows the server explanation without claiming readiness", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await read(page, `connect/${id}`, () => ({
    ...claimedConnection,
    organization_id: ORGANIZATION_ID,
    can_invite_installer: true,
    readiness: readiness("needs_local_confirmation", "Потрібна перевірка монтажником"),
  }));
  await route(page, `connect/${id}/installer-invitations`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({ email: "unknown@example.com", expires_in_days: 7 });
    await fulfillJson(request, 422, { detail: "Вкажіть пошту зареєстрованого монтажника із сервісним доступом" });
  });
  await page.goto(`/connect/${id}`);
  await page.getByText("Запросити монтажника", { exact: true }).click();
  await page.getByLabel("Пошта монтажника", { exact: true }).fill("unknown@example.com");
  await page.getByRole("button", { name: "Надіслати запрошення", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Вкажіть пошту зареєстрованого монтажника із сервісним доступом" }),
  ).toHaveText("Вкажіть пошту зареєстрованого монтажника із сервісним доступом");
  await expect(page.getByText("Потрібна перевірка монтажником", { exact: true })).toBeVisible();
  await expectNoTechnicalSetup(page);
});

for (const existing of [false, true])
  test(`simple QR activation uses ${existing ? "an existing object" : "a new personal object"} without technical setup`, async ({
    page,
  }) => {
    await mockAuthenticatedWorkspace(page);
    let claims = 0;
    const unclaimed = {
      ...connection,
      hardware_model: "KERUMO V4",
      network_transport: "lte",
      readiness: readiness("needs_equipment", "Активація контролера"),
    };
    const claimed = { ...claimedConnection, readiness: readiness("needs_equipment", "Монтажник готує обладнання") };
    await read(page, `connect/${id}`, () => (claims ? claimed : unclaimed));
    await read(page, "connect/sites", () => [{ id: SITE_ID, name: "Existing site" }]);
    await read(page, "connect/organizations", () => []);
    await route(page, `connect/${id}/claim`, async (request) => {
      claims++;
      expect(request.request().postDataJSON()).toEqual({
        activation_code: activation,
        device_name: "KERUMO V4",
        ...(existing ? { site_id: SITE_ID } : { new_site: { name: "My well", timezone: "Europe/Kyiv" } }),
      });
      await fulfillJson(request, 200, claimed);
    });
    await page.goto(`/connect/${id}`);
    await expect(page.getByLabel("Назва організації", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("Часовий пояс", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("Назва контролера", { exact: true })).not.toBeVisible();
    if (existing) await page.getByLabel("Куди додати контролер", { exact: true }).selectOption(SITE_ID);
    else await page.getByLabel("Назва об’єкта", { exact: true }).fill("My well");
    await page.getByLabel("Пароль активації з картки", { exact: true }).fill(activation);
    await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
    await expect(
      page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
    ).toBeVisible();
    expect(claims).toBe(1);
    await expectNoTechnicalSetup(page);
    await expect(page.getByRole("link", { name: "Монтаж і перевірка", exact: true })).toHaveCount(0);
    await noStoredSecrets(page, activation);
  });

test("advanced activation preserves explicit organization, timezone and device name", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let claims = 0;
  await read(page, `connect/${id}`, () =>
    claims
      ? { ...claimedConnection, readiness: readiness("needs_equipment", "Монтажник готує обладнання") }
      : { ...connection, readiness: readiness("needs_equipment", "Активація контролера") },
  );
  await read(page, "connect/sites", () => []);
  await read(page, "connect/organizations", () => [
    { id: "670b979d-9e60-5207-a5d2-5d86ee70c71c", name: "Existing team" },
  ]);
  await route(page, `connect/${id}/claim`, async (request) => {
    claims++;
    expect(request.request().postDataJSON()).toEqual({
      activation_code: activation,
      device_name: "Pump 2",
      new_site: { name: "Well 2", timezone: "Europe/Warsaw", organization_id: "670b979d-9e60-5207-a5d2-5d86ee70c71c" },
    });
    await fulfillJson(request, 200, {
      ...claimedConnection,
      readiness: readiness("needs_equipment", "Монтажник готує обладнання"),
    });
  });
  await page.goto(`/connect/${id}`);
  await page.getByLabel("Назва об’єкта", { exact: true }).fill("Well 2");
  await page.getByText("Назва пристрою та інші параметри", { exact: true }).click();
  await page.getByLabel("Назва контролера", { exact: true }).fill("Pump 2");
  await page
    .getByLabel("Організація для нового об’єкта", { exact: true })
    .selectOption("670b979d-9e60-5207-a5d2-5d86ee70c71c");
  await page.getByLabel("Часовий пояс", { exact: true }).fill("Europe/Warsaw");
  await page.getByLabel("Пароль активації з картки", { exact: true }).fill(activation);
  await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
  await expect(
    page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
  ).toBeVisible();
  expect(claims).toBe(1);
  await noStoredSecrets(page, activation);
});

test("two default activations reuse the personal workspace without requesting duplicate organizations", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await read(page, "connect/sites", () => []);
  await read(page, "connect/organizations", () => []);
  const controllers = [id, "22222222-2222-4222-8222-222222222222"];
  const posted: unknown[] = [];
  for (const [index, controllerId] of controllers.entries()) {
    let claimed = false;
    await read(page, `connect/${controllerId}`, () => ({
      ...(claimed ? claimedConnection : connection),
      controller_id: controllerId,
      readiness: readiness("needs_equipment", "Монтажник готує обладнання"),
    }));
    await route(page, `connect/${controllerId}/claim`, async (request) => {
      const body = request.request().postDataJSON();
      expect(body.new_site).toEqual({ name: `Well ${index + 1}`, timezone: "Europe/Kyiv" });
      expect(body.new_site).not.toHaveProperty("organization_name");
      expect(body.new_site).not.toHaveProperty("organization_id");
      posted.push(body);
      claimed = true;
      await fulfillJson(request, 200, {
        ...claimedConnection,
        controller_id: controllerId,
        readiness: readiness("needs_equipment", "Монтажник готує обладнання"),
      });
    });
    await page.goto(`/connect/${controllerId}`);
    await page.getByLabel("Назва об’єкта", { exact: true }).fill(`Well ${index + 1}`);
    await page.getByLabel("Пароль активації з картки", { exact: true }).fill(activation);
    await page.getByRole("button", { name: "Активувати контролер", exact: true }).click();
    await expect(
      page.getByText("Контролер прив’язано до вашого об’єкта. Повторна активація не потрібна.", { exact: true }),
    ).toBeVisible();
  }
  expect(posted).toHaveLength(2);
  await noStoredSecrets(page, activation);
});
