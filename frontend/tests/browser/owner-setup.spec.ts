import { expect, test, type Page, type Route } from "@playwright/test";
import {
  API_ORIGIN,
  DEVICE_ID,
  ORGANIZATION_ID,
  SITE_ID,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";
import {
  emptySetupEquipment,
  helperSetupFixture,
  HELPER_ID,
  HELPER_TOKEN,
  ownerSetupFixture,
  SETUP_CONTROLLER_ID as id,
  setupEquipment,
  setupProfile,
} from "../fixtures/setup";
import { setupScope, type OwnerSetupRead } from "../../src/lib/api/setup";

async function route(page: Page, path: string, handler: (route: Route) => Promise<void>) {
  await page.route(`${API_ORIGIN}/api/v1/${path}`, async (request) => {
    if (!(await fulfillPreflight(request))) await handler(request);
  });
}
async function ownerPage(page: Page, current: () => OwnerSetupRead) {
  await mockAuthenticatedWorkspace(page);
  await route(page, `connect/${id}`, (request) =>
    fulfillJson(request, 200, {
      can_install: false,
      can_invite_installer: true,
      can_setup: true,
      organization_id: ORGANIZATION_ID,
      controller_id: id,
      device_id: DEVICE_ID,
      site_id: SITE_ID,
      state: "claimed",
      serial_number: "SETUP-001",
      hardware_model: "KERUMO V4",
      network_transport: "lte",
      connection_state: "online",
      telemetry_received_at: new Date().toISOString(),
      last_contact_at: new Date().toISOString(),
      firmware_version: "0.12.1",
      readiness: { state: "needs_commissioning", title: "Підготовка установки", next_action: null, blockers: [] },
    }),
  );
  await route(page, `connect/${id}/setup`, (request) => fulfillJson(request, 200, current()));
  await route(page, "equipment/profiles", (request) => fulfillJson(request, 200, [setupProfile]));
  await route(page, `connect/${id}/setup/helpers`, (request) => fulfillJson(request, 200, []));
}
async function fillMissing(page: Page) {
  await page.getByLabel("Серія частотника SUSWE", { exact: true }).selectOption(setupProfile.id);
  await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill(setupEquipment.model!);
  for (const [label, value] of [
    ["Номінальна частота двигуна, Гц", "50"],
    ["Номінальний струм двигуна, А", "12"],
    ["Номінальна напруга двигуна, В", "380"],
    ["Номінальна потужність двигуна, кВт", "5.5"],
    ["Мінімальна робоча частота, Гц", "10"],
    ["Максимальна робоча частота, Гц", "50"],
  ])
    await page.getByLabel(label!, { exact: true }).fill(value!);
}
test("prepared owner kit skips duplicate entry and requires explicit acceptance without RUN", async ({ page }) => {
  let state = ownerSetupFixture(),
    accepts = 0,
    commands = 0,
    drafts = 0;
  await ownerPage(page, () => state);
  await route(page, `devices/${DEVICE_ID}/commands`, async (request) => {
    commands++;
    await fulfillJson(request, 403, {});
  });
  await route(page, `connect/${id}/setup/draft`, async (request) => {
    drafts++;
    await fulfillJson(request, 403, {});
  });
  await route(page, `connect/${id}/setup/accept`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({
      ...setupScope(state),
      expected_configuration_hash: state.configuration_hash,
      installation_checked: true,
      control_mode: "extended_test",
    });
    accepts++;
    state = {
      ...state,
      initial_setup_open: false,
      can_accept_control: false,
      can_accept_read_only: false,
      completed_at: new Date().toISOString(),
      progress: "ready",
    };
    await fulfillJson(request, 200, state);
  });
  await page.goto(`/connect/${id}`);
  await expect(page.getByRole("list", { name: "Готовність контролера" }).locator("li")).toHaveCount(3);
  await expect(page.getByLabel("Номінальний струм двигуна, А", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Прийняти установку", exact: true })).toBeDisabled();
  await page.getByLabel("Перевірив монтаж на місці та приймаю установку", { exact: true }).check();
  await page.getByRole("button", { name: "Прийняти установку", exact: true }).click();
  await expect(page.getByText("Перевірки установки завершено", { exact: true })).toBeVisible();
  expect({ accepts, commands, drafts }).toEqual({ accepts: 1, commands: 0, drafts: 0 });
});

test("standalone owner saves a proposal, reviews it and gets the local confirmation guide", async ({ page }) => {
  let state = ownerSetupFixture({
    equipment: emptySetupEquipment,
    configured_equipment: null,
    configuration_revision: 0,
    configuration_hash: null,
    needs_apply: true,
    can_accept_control: false,
    can_accept_read_only: false,
    missing_fields: [
      "profile_id",
      "model",
      "frequency_limits",
      "motor.rated_frequency_hz",
      "motor.rated_current_a",
      "motor.rated_voltage_v",
      "motor.rated_power_kw",
    ],
  });
  await ownerPage(page, () => state);
  await route(page, `connect/${id}/setup/draft`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({ ...setupScope(state), equipment: setupEquipment });
    state = { ...state, equipment: setupEquipment, missing_fields: [], draft_revision: 1, can_apply: true };
    await fulfillJson(request, 200, state);
  });
  await route(page, `connect/${id}/setup/apply`, async (request) => {
    expect(request.request().postDataJSON()).toEqual({ ...setupScope(state), nameplate_checked: true });
    state = {
      ...state,
      configuration_hash: "b".repeat(64),
      configuration_revision: 1,
      configured_equipment: setupEquipment,
      needs_apply: false,
      can_apply: false,
      checks: [{ code: "local_confirmation", title: "Перевірка біля установки", status: "pending", detail: null }],
    };
    await fulfillJson(request, 200, state);
  });
  await page.goto(`/connect/${id}`);
  await fillMissing(page);
  await page.getByRole("button", { name: "Зберегти дані", exact: true }).click();
  await expect(page.getByRole("button", { name: "Підтвердити дані установки", exact: true })).toBeDisabled();
  await page.getByLabel("Звірив модель, дані двигуна й робочі межі з фактичною установкою", { exact: true }).check();
  await page.getByRole("button", { name: "Підтвердити дані установки", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Перевірте монтаж біля установки", exact: true })).toBeVisible();
  await expect(page.getByText("http://192.168.4.1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Прийняти установку", exact: true })).toHaveCount(0);
});

test("a form retains its values and blocks writes after another proposal changes its revision", async ({ page }) => {
  let state = ownerSetupFixture();
  await ownerPage(page, () => state);
  await page.goto(`/connect/${id}`);
  await page.getByRole("button", { name: "Виправити дані обладнання", exact: true }).click();
  await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill("MY UNSAVED MODEL");
  state = { ...state, draft_revision: 2, equipment: { ...state.equipment, model: "OTHER PROPOSAL" } };
  await expect(
    page.getByText("Дані установки змінилися. Цю чернетку не можна зберегти поверх нових даних.", { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await expect(page.getByLabel("Повна модель частотника зі шильдика", { exact: true })).toHaveValue("MY UNSAVED MODEL");
  await expect(page.getByRole("button", { name: "Зберегти дані", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Завантажити актуальні дані", exact: true }).click();
  await expect(page.getByLabel("Повна модель частотника зі шильдика", { exact: true })).toHaveValue("OTHER PROPOSAL");
});

test("observation can be accepted explicitly with incomplete motor data", async ({ page }) => {
  let state = ownerSetupFixture({
    equipment: { ...setupEquipment, motor: { ...setupEquipment.motor!, rated_current_a: null } },
    missing_fields: ["motor.rated_current_a"],
    can_accept_control: false,
  });
  await ownerPage(page, () => state);
  let mode = "";
  await route(page, `connect/${id}/setup/accept`, async (request) => {
    mode = request.request().postDataJSON().control_mode;
    state = {
      ...state,
      initial_setup_open: false,
      can_accept_read_only: false,
      commissioned_control_mode: "read_only",
      progress: "ready",
    };
    await fulfillJson(request, 200, state);
  });
  await page.goto(`/connect/${id}`);
  await expect(page.getByLabel("Номінальний струм двигуна, А", { exact: true })).toBeVisible();
  await expect(page.getByText(/Первинне налаштування закриється/u)).toBeVisible();
  await page
    .getByLabel("Приймаю збережені дані й завершую налаштування лише для спостереження", { exact: true })
    .check();
  await page.getByRole("button", { name: "Завершити для спостереження", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завершити для спостереження", exact: true })).toHaveCount(0);
  expect(mode).toBe("read_only");
  await expect(page.getByRole("list", { name: "Готовність контролера" })).toContainText("Готово до спостереження");
});

test("a standalone partial nameplate can apply reviewed saved data before observation", async ({ page }) => {
  let state = ownerSetupFixture({
    equipment: { ...setupEquipment, motor: { ...setupEquipment.motor!, rated_current_a: null } },
    configured_equipment: null,
    configuration_hash: null,
    configuration_revision: 0,
    draft_revision: 1,
    missing_fields: ["motor.rated_current_a"],
    needs_apply: true,
    can_apply: true,
    can_accept_control: false,
    can_accept_read_only: false,
  });
  await ownerPage(page, () => state);
  let applies = 0;
  await route(page, `connect/${id}/setup/apply`, async (request) => {
    applies++;
    expect(request.request().postDataJSON()).toEqual({ ...setupScope(state), nameplate_checked: true });
    state = {
      ...state,
      configured_equipment: state.equipment,
      configuration_hash: "b".repeat(64),
      configuration_revision: 1,
      needs_apply: false,
      can_apply: false,
    };
    await fulfillJson(request, 200, state);
  });
  await page.goto(`/connect/${id}`);
  await expect(page.getByLabel("Номінальний струм двигуна, А", { exact: true })).toBeVisible();
  await page.getByLabel("Звірив модель, дані двигуна й робочі межі з фактичною установкою", { exact: true }).check();
  await page.getByRole("button", { name: "Підтвердити дані установки", exact: true }).click();
  await expect(page.getByRole("button", { name: "Підтвердити дані установки", exact: true })).toHaveCount(0);
  expect(applies).toBe(1);
});

test("an observation confirmation cannot turn into a control confirmation after polling", async ({ page }) => {
  let state = ownerSetupFixture({ can_accept_control: false });
  await ownerPage(page, () => state);
  await page.goto(`/connect/${id}`);
  await page
    .getByLabel("Приймаю збережені дані й завершую налаштування лише для спостереження", { exact: true })
    .check();
  state = { ...state, can_accept_control: true };
  await expect(page.getByRole("button", { name: "Прийняти установку", exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole("button", { name: "Прийняти установку", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Перевірив монтаж на місці та приймаю установку", { exact: true })).not.toBeChecked();
});

test("anonymous helper strips its proof, sends no account credentials and only proposes data", async ({ page }) => {
  let state = helperSetupFixture(),
    writes = 0;
  const requested: string[] = [];
  await page.context().addCookies([{ name: "unrelated_account_cookie", value: "account-proof", url: API_ORIGIN }]);
  page.on("request", (request) => {
    if (request.url().startsWith(API_ORIGIN) && request.method() !== "OPTIONS")
      requested.push(new URL(request.url()).pathname);
  });
  await route(page, "setup-help/inspect", async (request) => {
    expect(request.request().postDataJSON()).toEqual({ token: HELPER_TOKEN });
    expect(request.request().headers().authorization).toBeUndefined();
    expect((await request.request().allHeaders()).cookie).toBeUndefined();
    await fulfillJson(request, 200, state);
  });
  await route(page, "setup-help/draft", async (request) => {
    expect(request.request().postDataJSON()).toEqual({
      token: HELPER_TOKEN,
      ...setupScope(state),
      equipment: { ...setupEquipment, model: "SU300 UNKNOWN" },
    });
    expect(request.request().headers().authorization).toBeUndefined();
    writes++;
    state = { ...state, draft_revision: 1, equipment: { ...setupEquipment, model: "SU300 UNKNOWN" } };
    await fulfillJson(request, 200, state);
  });
  await page.goto(`/setup-help#token=${HELPER_TOKEN}`);
  await expect(page).toHaveURL("/setup-help");
  await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill("SU300 UNKNOWN");
  await page.getByRole("button", { name: "Передати дані власнику", exact: true }).click();
  await expect(
    page.getByText("Дані передано власнику на перевірку. Він побачить їх у підключенні контролера.", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(requested.every((path) => path.startsWith("/api/v1/setup-help/"))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(HELPER_TOKEN);
  await expect(page.getByRole("button", { name: /Прийняти установку|ПУСК|START/u })).toHaveCount(0);
});

test("revoked helper proof hides setup and never prompts for an account", async ({ page }) => {
  await route(page, "setup-help/inspect", (request) =>
    fulfillJson(request, 404, { detail: "Посилання недійсне або відкликане" }),
  );
  await page.goto(`/setup-help#token=${HELPER_TOKEN}`);
  await expect(page.locator("main [role=alert]")).toContainText("Посилання недійсне або відкликане");
  await expect(page.getByRole("button", { name: "Передати дані власнику", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Пароль", { exact: true })).toHaveCount(0);
});

for (const width of [320, 1440])
  test(`owner setup remains readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = ownerSetupFixture({
      equipment: emptySetupEquipment,
      configured_equipment: null,
      configuration_hash: null,
      configuration_revision: 0,
      can_accept_control: false,
      can_accept_read_only: false,
      needs_apply: true,
      missing_fields: [
        "profile_id",
        "model",
        "frequency_limits",
        "motor.rated_frequency_hz",
        "motor.rated_current_a",
        "motor.rated_voltage_v",
        "motor.rated_power_kw",
      ],
    });
    await ownerPage(page, () => state);
    await page.goto(`/connect/${id}`);
    await expect(page.getByLabel("Номінальний струм двигуна, А", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`owner-setup-${width}.png`), fullPage: true });
  });

test("owner can issue a helper link, reload without its secret and revoke existing access", async ({ page }) => {
  const state = ownerSetupFixture();
  await ownerPage(page, () => state);
  const link = {
    id: HELPER_ID,
    created_at: "2026-10-13T12:00:00Z",
    expires_at: "2099-10-13T14:00:00Z",
    revoked_at: null,
    active: true,
  };
  let issued = false,
    revoked = false;
  await route(page, `connect/${id}/setup/helpers`, async (request) => {
    if (request.request().method() === "POST") {
      expect(request.request().postDataJSON()).toEqual(setupScope(state));
      issued = true;
      await fulfillJson(request, 201, { ...link, token: HELPER_TOKEN });
    } else await fulfillJson(request, 200, issued && !revoked ? [link] : []);
  });
  await route(page, `connect/${id}/setup/helpers/${HELPER_ID}`, async (request) => {
    expect(request.request().method()).toBe("DELETE");
    revoked = true;
    await request.fulfill({
      status: 204,
      headers: { "access-control-allow-origin": "http://127.0.0.1:3000", "access-control-allow-credentials": "true" },
    });
  });
  await page.goto(`/connect/${id}`);
  await page.getByText("Допомога з первинним налаштуванням", { exact: true }).click();
  await page.getByRole("button", { name: "Створити посилання для помічника", exact: true }).click();
  await expect(page.getByLabel("Посилання для помічника", { exact: true })).toHaveValue(
    new RegExp(HELPER_TOKEN.replace(".", "\\.")),
  );
  await page.reload();
  await page.getByText("Допомога з первинним налаштуванням", { exact: true }).click();
  await expect(page.getByLabel("Посилання для помічника", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Відкликати посилання", exact: true }).click();
  await expect(page.getByRole("button", { name: "Відкликати посилання", exact: true })).toHaveCount(0);
  expect(revoked).toBe(true);
});
