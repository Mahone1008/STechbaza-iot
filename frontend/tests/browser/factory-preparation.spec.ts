import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { components } from "../../src/lib/api/schema";
import { API_ORIGIN, fulfillJson, fulfillPreflight, mockAuthenticatedWorkspace } from "./auth-fixtures";

type Schema = components["schemas"];
const id = "d3897a58-3704-4d6a-b5f9-d7b72d850766";
const profile: Schema["ProfileRead"] = {
  id: "suswe.su600.modbus",
  version: 1,
  manufacturer: "SUSWE",
  series: "SU600",
  support: "bench_limited",
  driver_id: "suswe.su600",
  driver_version: 1,
  command_protocol: 3,
  tested_model: "SU600A-5RG1-B",
  manual: null,
  manual_pages: [],
  manual_sha256: null,
  profile_hash: "a".repeat(64),
  notes: [],
  parameter_family: "F",
};
const equipment = {
  profile_id: profile.id,
  profile_version: 1,
  model: "SU600A-5RG1-B",
  serial_number: null,
  hardware_revision: null,
  software_revision: null,
  motor: { rated_frequency_hz: 50, rated_current_a: null, rated_voltage_v: null, rated_power_kw: null },
  frequency_limits: { min_hz: 30, max_hz: 50 },
};
const controller: Schema["FactoryRead"] = {
  access_revoked: false,
  credential_revision: 0,
  firmware_control_capability: "read_only",
  transport_editable: true,
  id,
  serial_number: "FACTORY-LTE-001",
  hardware_model: "KERUMO V4",
  hardware_revision: "4.1",
  batch: "test",
  network_transport: "lte",
  status: "ready",
  generation: 1,
  distributor: null,
  claimed_at: null,
  device_id: null,
  last_contact_at: null,
  prepared_equipment: null,
  preparation_revision: 0,
  preparation_editable: true,
};
async function route(page: Page, path: string, handle: (route: Route) => Promise<void>) {
  await page.route(`${API_ORIGIN}/api/v1/${path}`, async (request) => {
    if (!(await fulfillPreflight(request))) await handle(request);
  });
}
async function registerFields(page: Page) {
  await page.getByLabel("Інтернет контролера", { exact: true }).selectOption("lte");
  for (const [label, value] of [
    ["Серійний номер", controller.serial_number],
    ["Апаратна ревізія", "4.1"],
    ["Партія", "test"],
    ["Номер протоколу заводської перевірки", "LTE-PREP-001"],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("checkbox", { name: "Контролер пройшов заводську перевірку", exact: true }).check();
}

test("manufacturer prepares a real VFD passport without marking physical installation complete", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
  const kit = {
    controller: { ...controller, prepared_equipment: equipment, preparation_revision: 1 },
    qr_path: `/connect/${id}`,
    activation_code: "a".repeat(43),
    password: "a".repeat(43),
    login: "factory-fixture-login",
    bootstrap_key: "b".repeat(43),
    setup_password: "local-fixture-only-password",
  };
  let creates = 0;
  await route(page, "factory/controllers*", async (request) => {
    if (request.request().method() === "POST") {
      creates++;
      expect(request.request().postDataJSON()).toMatchObject({ network_transport: "lte", equipment });
      expect(request.request().postDataJSON()).not.toHaveProperty("installation_checked");
      await fulfillJson(request, 201, kit);
    } else await fulfillJson(request, 200, creates ? [kit.controller] : []);
  });
  await route(page, "equipment/profiles", (request) =>
    fulfillJson(request, 200, [
      profile,
      { ...profile, id: "sigma.inventory", manufacturer: "SIGMA", series: "Sigma", driver_id: null },
    ]),
  );
  await page.goto("/factory");
  await registerFields(page);
  await page.getByLabel("Комплект постачання", { exact: true }).selectOption("cabinet");
  const series = page.getByLabel("Серія частотника SUSWE", { exact: true });
  await series.selectOption("SU600");
  await expect(series.locator("option")).not.toContainText(["Sigma"]);
  const issue = page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true });
  await expect(issue).toBeDisabled();
  await expect(page.getByLabel("Номінальна частота двигуна, Гц", { exact: true })).toHaveValue("");
  await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill("S123456789");
  await expect(
    page.getByText("Для цієї повної моделі ще немає перевіреного драйвера. Підготовка керування недоступна.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill(equipment.model);
  await page.getByLabel("Номінальна частота двигуна, Гц", { exact: true }).fill("50");
  await page.getByLabel("Мінімальна робоча частота, Гц", { exact: true }).fill("30");
  await page.getByLabel("Максимальна робоча частота, Гц", { exact: true }).fill("50");
  await expect(issue).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "Паспорт звірено зі шильдиками; робочі межі обрано для цієї установки",
      exact: true,
    })
    .check();
  await issue.click();
  await expect(
    page.getByText("Паспорт підготовлено; монтаж потрібно підтвердити", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".factory-public-label svg")).toHaveCount(1);
  await expect(page.locator(".factory-private-label svg")).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Завантажити заводський комплект", exact: true }).click();
  const file = await (await downloading).path();
  expect(file).not.toBeNull();
  const saved = JSON.parse(await readFile(file!, "utf8"));
  expect(saved.controller.prepared_equipment).toEqual(equipment);
  expect(saved.controller.preparation_revision).toBe(1);
  expect(creates).toBe(1);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of [kit.password, kit.bootstrap_key, kit.setup_password]) {
    expect(stored).not.toContain(secret);
    expect(page.url()).not.toContain(secret);
  }
});

test("controller-only registration does not require a guessed model or motor", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
  let catalogReads = 0;
  await route(page, "equipment/profiles", async (request) => {
    catalogReads++;
    await fulfillJson(request, 200, [profile]);
  });
  await route(page, "factory/controllers*", async (request) => {
    if (request.request().method() === "POST") {
      expect(request.request().postDataJSON().equipment).toBeNull();
      await fulfillJson(request, 201, {
        controller,
        qr_path: `/connect/${id}`,
        activation_code: "a".repeat(43),
        password: "a".repeat(43),
        login: "unused-login",
        bootstrap_key: "b".repeat(43),
        setup_password: "setup-password",
      });
    } else await fulfillJson(request, 200, []);
  });
  await page.goto("/factory");
  await registerFields(page);
  await expect(page.getByLabel("Повна модель частотника зі шильдика", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Зареєструвати і видати ключі", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завантажити заводський комплект", exact: true })).toBeVisible();
  expect(catalogReads).toBe(0);
});

test("manufacturer can repair an unused claimed passport without resetting its owner or QR", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
  let prepared = false,
    patches = 0;
  const claimed = {
    ...controller,
    status: "claimed",
    device_id: "e427aeab-9625-4967-ab12-4910c66b47ac",
    claimed_at: "2026-10-12T10:00:00Z",
  };
  await route(page, "factory/controllers?*", (request) =>
    fulfillJson(request, 200, [
      {
        ...claimed,
        prepared_equipment: prepared ? equipment : null,
        preparation_revision: prepared ? 1 : 0,
      },
    ]),
  );
  await route(page, "equipment/profiles", (request) => fulfillJson(request, 200, [profile]));
  await route(page, `factory/controllers/${id}/equipment`, async (request) => {
    patches++;
    expect(request.request().method()).toBe("PATCH");
    expect(request.request().postDataJSON()).toEqual({
      expected_generation: 1,
      expected_preparation_revision: 0,
      equipment,
    });
    prepared = true;
    await fulfillJson(request, 200, { ...claimed, prepared_equipment: equipment, preparation_revision: 1 });
  });
  await page.goto("/factory");
  await page.getByRole("button", { name: "Підготувати паспорт обладнання", exact: true }).click();
  const editor = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: `Паспорт · ${controller.serial_number}`, exact: true }) });
  await editor.getByLabel("Комплект постачання", { exact: true }).selectOption("cabinet");
  await editor.getByLabel("Серія частотника SUSWE", { exact: true }).selectOption("SU600");
  await editor.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill(equipment.model);
  await editor.getByLabel("Номінальна частота двигуна, Гц", { exact: true }).fill("50");
  await editor.getByLabel("Мінімальна робоча частота, Гц", { exact: true }).fill("30");
  await editor.getByLabel("Максимальна робоча частота, Гц", { exact: true }).fill("50");
  await editor
    .getByRole("checkbox", {
      name: "Паспорт звірено зі шильдиками; робочі межі обрано для цієї установки",
      exact: true,
    })
    .check();
  await editor.getByRole("button", { name: "Зберегти підготовлений паспорт", exact: true }).click();
  await expect(page.getByRole("button", { name: "Змінити підготовлений паспорт", exact: true })).toBeVisible();
  await expect(page.locator(".device-events")).toContainText("Активований покупцем");
  await expect(page.locator(".device-events")).toContainText(equipment.model);
  await expect(page.locator(".factory-public-label")).toHaveCount(0);
  expect(patches).toBe(1);
});

test("a refreshed factory revision cannot overwrite a passport that was reviewed earlier", async ({ page }) => {
  await mockAuthenticatedWorkspace(page, { platformRole: "superadmin" });
  let revision = 1,
    patches = 0;
  const current = () => ({
    ...controller,
    preparation_revision: revision,
    prepared_equipment: {
      ...equipment,
      frequency_limits: { min_hz: 30, max_hz: revision === 1 ? 50 : 45 },
    },
  });
  await route(page, "factory/controllers?*", (request) => fulfillJson(request, 200, [current()]));
  await route(page, "equipment/profiles", (request) => fulfillJson(request, 200, [profile]));
  await route(page, `factory/controllers/${id}/shipments`, async (request) => {
    revision = 2;
    await fulfillJson(request, 200, current());
  });
  await route(page, `factory/controllers/${id}/equipment`, async (request) => {
    patches++;
    await fulfillJson(request, 409, { detail: "Паспорт змінено в іншому вікні" });
  });
  await page.goto("/factory");
  await page.getByRole("button", { name: "Змінити підготовлений паспорт", exact: true }).click();
  const editor = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: `Паспорт · ${controller.serial_number}`, exact: true }) });
  await editor.getByLabel("Максимальна робоча частота, Гц", { exact: true }).fill("40");
  await editor
    .getByRole("checkbox", {
      name: "Паспорт звірено зі шильдиками; робочі межі обрано для цієї установки",
      exact: true,
    })
    .check();
  const save = editor.getByRole("button", { name: "Зберегти підготовлений паспорт", exact: true });
  await expect(save).toBeEnabled();
  await page.getByLabel("Оптовик або отримувач партії", { exact: true }).fill("Warehouse fixture");
  await page.getByLabel("Номер документа постачання", { exact: true }).fill("INV-REVISION-TEST");
  await page.getByRole("button", { name: "Записати постачання", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Паспорт або стан контролера змінився");
  await expect(save).toBeDisabled();
  expect(patches).toBe(0);
  await editor.getByRole("button", { name: "Скасувати", exact: true }).click();
  await page.getByRole("button", { name: "Змінити підготовлений паспорт", exact: true }).click();
  await expect(editor.getByLabel("Максимальна робоча частота, Гц", { exact: true })).toHaveValue("45");
});
