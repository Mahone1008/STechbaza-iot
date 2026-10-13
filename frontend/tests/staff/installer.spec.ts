import { expect, test, type Page } from "@playwright/test";
import type { components } from "../../src/lib/api/schema";
import { overviewFixture } from "../fixtures/overview";
import { refreshButton } from "../helpers/customer-details";
import {
  accessPayload,
  currentUserPayload,
  devicePayload,
  organizationPayload,
  sitePayload,
  tokenPayload,
  DEVICE_ID,
  ORGANIZATION_ID,
  SITE_ID,
} from "../browser/auth-fixtures";

type Schema = components["schemas"];
const controllerId = "11111111-1111-4111-8111-111111111111";
const installationId = "22222222-2222-4222-8222-222222222222";
const moduleId = "33333333-3333-4333-8333-333333333333";
const profile: Schema["ProfileRead"] = {
  id: "suswe.su600.modbus",
  version: 1,
  profile_hash: "a".repeat(64),
  manufacturer: "SUSWE",
  series: "SU600",
  parameter_family: "F",
  support: "bench_limited",
  driver_id: "suswe.su600",
  driver_version: 1,
  command_protocol: 3,
  tested_model: "SU600A-5RG1-B",
  manual: "manual",
  manual_sha256: "b".repeat(64),
  manual_pages: [1],
  notes: [],
};
function passport(): Schema["EquipmentPassport"] {
  return {
    device_id: DEVICE_ID,
    controller_uid: devicePayload().uid,
    controller_id: controllerId,
    firmware_version: "0.12.0",
    installations: [{ id: installationId, site_id: SITE_ID, name: "Насосна установка" }],
    modules: [],
    desired: null,
    reported: null,
    configuration_state: "legacy",
    can_install: true,
    firmware_control_capability: "full",
    commissioned_control_mode: null,
    readiness: {
      state: "needs_equipment",
      title: "Паспорт готує сервіс",
      next_action: "Заповніть паспорт установки",
      blockers: [],
    },
  };
}
function addModule(data: Schema["EquipmentPassport"], model = profile.tested_model!) {
  data.modules = [
    {
      id: moduleId,
      device_id: DEVICE_ID,
      installation_id: installationId,
      slot: "vfd-1",
      kind: "vfd",
      name: "Частотний перетворювач",
      manufacturer: "SUSWE",
      series: "SU600",
      model,
      serial_number: "VFD-123",
      hardware_revision: null,
      software_revision: null,
      motor: { rated_frequency_hz: 50, rated_current_a: null, rated_voltage_v: null, rated_power_kw: null },
      retired_at: null,
    },
  ];
}
function configure(data: Schema["EquipmentPassport"], verified: boolean) {
  const manifest: Schema["EquipmentManifest"] = {
    version: 1,
    device_uid: data.controller_uid,
    module_id: moduleId,
    binding_id: "55555555-5555-4555-8555-555555555555",
    binding_generation: 1,
    revision: 1,
    profile_id: profile.id,
    profile_version: profile.version,
    profile_hash: profile.profile_hash,
    driver_id: profile.driver_id!,
    driver_version: profile.driver_version!,
    bus: { transport: "modbus_rtu", address: 1, baud: 9600, parity: "none", stop_bits: 1 },
    frequency_limits: { min_hz: 15, max_hz: 45 },
  };
  data.desired = {
    manifest,
    configuration_hash: "c".repeat(64),
    created_at: new Date().toISOString(),
    actor_user_id: controllerId,
  };
  data.configuration_state = verified ? "verified" : "awaiting";
  data.readiness = {
    state: verified ? "needs_commissioning" : "needs_local_confirmation",
    title: verified ? "Установка очікує дозволу" : "Потрібна місцева перевірка",
    next_action: null,
    blockers: [],
  };
  data.reported = verified
    ? {
        module_id: manifest.module_id,
        binding_id: manifest.binding_id,
        binding_generation: manifest.binding_generation,
        revision: manifest.revision,
        profile_id: manifest.profile_id,
        profile_version: manifest.profile_version,
        profile_hash: manifest.profile_hash,
        driver_id: manifest.driver_id,
        driver_version: manifest.driver_version,
        configuration_hash: data.desired.configuration_hash,
        command_protocol: 3,
        compatible: true,
      }
    : null;
}
async function setup(
  page: Page,
  data: Schema["EquipmentPassport"],
  role: "superadmin" | "service_admin" = "service_admin",
) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const identity = { platformRole: role, role: "service" as const };
  const overview = overviewFixture(devicePayload());
  overview.access.platform_role = role;
  overview.access.organization_role = "service";
  await page.route("http://127.0.0.1:8002/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:3001",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, x-techbaza-csrf",
    };
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/auth/browser/refresh")) return send(tokenPayload("installer"));
    if (path.endsWith("/auth/me")) return send(currentUserPayload(identity));
    if (path.endsWith("/auth/security"))
      return send({
        mfa_enabled: true,
        privileged_mfa_required: true,
        current_session_verified: true,
        recovery_available: true,
      });
    if (path === `/api/v1/devices/${DEVICE_ID}`) return send(devicePayload());
    if (path === `/api/v1/sites/${SITE_ID}`) return send(sitePayload());
    if (path === `/api/v1/organizations/${ORGANIZATION_ID}`) return send(organizationPayload());
    if (path.endsWith("/access")) return send(accessPayload(identity));
    if (path.endsWith("/overview")) return send(overview);
    if (path === `/api/v1/devices/${DEVICE_ID}/equipment`) return send(data);
    if (path === "/api/v1/equipment/profiles") return send([profile]);
    if (path === `/api/v1/connect/${controllerId}/equipment` && request.method() === "PUT") {
      writes.push({ path, body: request.postDataJSON() });
      addModule(data);
      return send(data);
    }
    if (path.endsWith("/equipment/configurations") && request.method() === "POST") {
      writes.push({ path, body: request.postDataJSON() });
      configure(data, false);
      return send(data, 201);
    }
    if (path.endsWith("/equipment/commission") && request.method() === "POST") {
      writes.push({ path, body: request.postDataJSON() });
      data.commissioned_control_mode = "extended_test";
      data.readiness = { state: "ready", title: "Готовий до керування", next_action: null, blockers: [] };
      return send(data);
    }
    return send([]);
  });
  await page.goto(`/devices/${DEVICE_ID}?view=equipment`);
  return writes;
}

for (const role of ["superadmin", "service_admin"] as const) {
  test(`installer can prepare a missing passport, verify equipment and grant full control as ${role}`, async ({
    page,
  }) => {
    const data = passport();
    const writes = await setup(page, data, role);
    await page.getByRole("button", { name: "Підготувати паспорт", exact: true }).click();
    await page.getByLabel("Серія частотника SUSWE", { exact: true }).selectOption(`${profile.id}:1`);
    await page.getByLabel("Повна модель частотника зі шильдика", { exact: true }).fill(profile.tested_model!);
    await page.getByLabel("Серійний номер частотника", { exact: true }).fill("VFD-123");
    await page.getByLabel("Номінальна частота двигуна зі шильдика, Гц", { exact: true }).fill("50");
    await page.getByLabel("Частотник і паспорт двигуна звірено зі шильдиками", { exact: true }).check();
    await page.getByRole("button", { name: "Зберегти паспорт", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.body).toMatchObject({
      model: profile.tested_model,
      serial_number: "VFD-123",
      motor: { rated_frequency_hz: 50, rated_current_a: null, rated_voltage_v: null, rated_power_kw: null },
      nameplate_confirmed: true,
    });
    await page.getByRole("button", { name: "Налаштувати робочі межі", exact: true }).click();
    await page.getByLabel("Мінімальна частота, Гц", { exact: true }).fill("15");
    await page.getByLabel("Максимальна частота, Гц", { exact: true }).fill("45");
    await page.getByLabel("Паспорт, підключення, межі та безпечну зупинку перевірено", { exact: true }).check();
    await page.getByRole("button", { name: "Зберегти налаштування", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Крок 3. Підтвердьте обладнання біля установки" })).toBeVisible();
    expect(writes[1]!.body).toMatchObject({
      profile_id: profile.id,
      frequency_limits: { min_hz: 15, max_hz: 45 },
      bus: { transport: "modbus_rtu", address: 1, baud: 9600 },
    });
    configure(data, true);
    await (await refreshButton(page, "Оновити паспорт")).click();
    await page.getByRole("button", { name: "Дозволити використання", exact: true }).click();
    await expect(page.getByLabel("Дозволене використання", { exact: true })).toHaveValue("extended_test");
    await page.getByLabel("Паспорт, підключення, межі та безпечну зупинку перевірено", { exact: true }).check();
    await page.getByRole("button", { name: "Зберегти налаштування", exact: true }).click();
    await expect.poll(() => writes.length).toBe(3);
    expect(writes[2]!.body).toEqual({
      expected_revision: 1,
      installation_checked: true,
      control_mode: "extended_test",
    });
    await expect(page.getByText("Готовий до керування", { exact: true }).first()).toBeVisible();
    expect(writes.some((write) => write.path.endsWith("/commands"))).toBe(false);
  });
}

test("scoped service without installation permission sees the passport but no technical forms", async ({ page }) => {
  const data = passport();
  data.can_install = false;
  addModule(data);
  await setup(page, data);
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Підготовка установки", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Виправити початковий паспорт", exact: true })).toHaveCount(0);
});

test("unapproved full model cannot be configured by selecting the SU600 series", async ({ page }) => {
  const data = passport();
  addModule(data, "S123456789");
  await setup(page, data);
  await page.getByRole("button", { name: "Налаштувати робочі межі", exact: true }).click();
  await expect(
    page.getByText("Для повної моделі з паспорта немає перевіреного драйвера.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Паспорт, підключення, межі та безпечну зупинку перевірено", { exact: true }).check();
  await expect(page.getByRole("button", { name: "Зберегти налаштування", exact: true })).toBeDisabled();
});

test("old ReadOnly firmware can be observed but cannot receive full-control permission", async ({ page }) => {
  const data = passport();
  addModule(data);
  configure(data, true);
  data.firmware_control_capability = "read_only";
  await setup(page, data);
  await expect(page.getByText("Керування: потрібно оновити стару ReadOnly-прошивку.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Дозволити використання", exact: true }).click();
  const mode = page.getByLabel("Дозволене використання", { exact: true });
  await expect(mode).toHaveValue("read_only");
  await expect(mode.locator('option[value="extended_test"]')).toHaveJSProperty("disabled", true);
  await expect(mode.locator('option[value="bench_without_motor"]')).toHaveJSProperty("disabled", true);
});

test("commission form uses the latest firmware capability after a ReadOnly board is updated", async ({ page }) => {
  const data = passport();
  addModule(data);
  configure(data, false);
  data.firmware_control_capability = "read_only";
  const writes = await setup(page, data);
  await expect(page.getByText("Керування: потрібно оновити стару ReadOnly-прошивку.", { exact: false })).toBeVisible();
  data.firmware_control_capability = "full";
  configure(data, true);
  await (await refreshButton(page, "Оновити паспорт")).click();
  await page.getByRole("button", { name: "Дозволити використання", exact: true }).click();
  await expect(page.getByLabel("Дозволене використання", { exact: true })).toHaveValue("extended_test");
  expect(writes).toEqual([]);
});

test("full-control firmware without a motor passport offers a bench grant instead of full control", async ({
  page,
}) => {
  const data = passport();
  addModule(data);
  configure(data, true);
  data.modules[0]!.motor = null;
  await setup(page, data);
  await page.getByRole("button", { name: "Дозволити використання", exact: true }).click();
  const mode = page.getByLabel("Дозволене використання", { exact: true });
  await expect(mode).toHaveValue("bench_without_motor");
  await expect(mode.locator('option[value="extended_test"]')).toHaveJSProperty("disabled", true);
  await expect(page.getByText("Для повного керування внесіть паспорт двигуна", { exact: false })).toBeVisible();
});

test("saved server grant does not mark installation ready before controller confirmation", async ({ page }) => {
  const data = passport();
  addModule(data);
  configure(data, true);
  data.commissioned_control_mode = "extended_test";
  data.readiness = {
    state: "needs_commissioning",
    title: "Очікуємо готовність контролера",
    next_action: null,
    blockers: ["Плата ще не підтвердила дозвіл"],
  };
  await setup(page, data);
  const step = page.getByRole("list", { name: "Кроки підготовки установки" }).getByRole("listitem").nth(3);
  await expect(step.getByText("Очікуємо підтвердження", { exact: true })).toBeVisible();
  await expect(step.getByText("Готово", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Як відновити місцевий дозвіл керування", { exact: true })).toBeVisible();
});
