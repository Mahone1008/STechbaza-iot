import { expect, test } from "@playwright/test";
import {
  API_ORIGIN,
  DEVICE_ID,
  SITE_ID,
  devicePayload,
  fulfillJson,
  fulfillPreflight,
  mockAuthenticatedWorkspace,
} from "./auth-fixtures";

test("customer owner gets a readable passport and transfer controls without installer forms", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route(`${API_ORIGIN}/api/v1/devices/${DEVICE_ID}/equipment`, async (route) => {
    if (await fulfillPreflight(route)) return;
    await fulfillJson(route, 200, {
      device_id: DEVICE_ID,
      controller_uid: devicePayload().uid,
      controller_id: "11111111-1111-4111-8111-111111111111",
      firmware_version: "0.12.0",
      can_install: true,
      configuration_state: "legacy",
      desired: null,
      reported: null,
      installations: [{ id: "22222222-2222-4222-8222-222222222222", site_id: SITE_ID, name: "Насосна установка" }],
      modules: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          device_id: DEVICE_ID,
          installation_id: "22222222-2222-4222-8222-222222222222",
          slot: "vfd-1",
          kind: "vfd",
          name: "Частотний перетворювач",
          manufacturer: "SUSWE",
          series: "SU600",
          model: "SU600A-5RG1-B",
          serial_number: "VFD-123",
          hardware_revision: null,
          software_revision: null,
          motor: { rated_frequency_hz: 50, rated_current_a: null, rated_voltage_v: null, rated_power_kw: null },
          retired_at: null,
        },
      ],
    });
  });
  await page.goto(`/devices/${DEVICE_ID}?view=equipment`);
  await expect(page.getByText("SUSWE SU600", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Підготовка установки", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Налаштувати робочі межі", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Замінити частотник", exact: true })).toHaveCount(0);
  await expect(page.getByText("Доступ і передача контролера", { exact: true })).toBeVisible();
});
