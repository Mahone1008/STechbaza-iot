import type { OwnerSetupRead, SetupEquipment, SetupHelperRead, SetupProfile } from "../../src/lib/api/setup";
import { DEVICE_ID } from "../browser/auth-fixtures";

export const SETUP_CONTROLLER_ID = "017ca46d-342c-4ab6-bd1c-89a602021951";
export const HELPER_ID = "017ca46d-342c-4ab6-bd1c-89a602021952";
export const HELPER_TOKEN = `${HELPER_ID.replaceAll("-", "")}.${"h".repeat(43)}`;
export const setupProfile: SetupProfile = {
  id: "suswe.su600.modbus",
  version: 1,
  manufacturer: "SUSWE",
  series: "SU600",
  support: "bench_limited",
  tested_model: "SU600A-5RG1-B",
};
export const setupEquipment: SetupEquipment = {
  profile_id: setupProfile.id,
  profile_version: 1,
  model: setupProfile.tested_model,
  serial_number: null,
  hardware_revision: null,
  software_revision: null,
  motor: { rated_frequency_hz: 50, rated_current_a: 12, rated_voltage_v: 380, rated_power_kw: 5.5 },
  frequency_limits: { min_hz: 10, max_hz: 50 },
};
export const emptySetupEquipment: SetupEquipment = {
  profile_id: null,
  profile_version: 1,
  model: null,
  serial_number: null,
  hardware_revision: null,
  software_revision: null,
  motor: null,
  frequency_limits: null,
};
export function ownerSetupFixture(overrides: Partial<OwnerSetupRead> = {}): OwnerSetupRead {
  return {
    controller_id: SETUP_CONTROLLER_ID,
    device_id: DEVICE_ID,
    generation: 1,
    credential_revision: 3,
    configuration_revision: 2,
    configuration_hash: "a".repeat(64),
    draft_revision: 0,
    applied_draft_revision: null,
    initial_setup_open: true,
    can_setup: true,
    completed_at: null,
    commissioned_control_mode: null,
    equipment: structuredClone(setupEquipment),
    configured_equipment: structuredClone(setupEquipment),
    missing_fields: [],
    checks: [
      { code: "connection", title: "Контролер на зв’язку", status: "passed", detail: null },
      { code: "installation", title: "Обладнання підтверджено", status: "passed", detail: null },
    ],
    progress: "connected",
    needs_apply: false,
    draft_stale: false,
    can_apply: false,
    can_accept_control: true,
    can_accept_read_only: true,
    ...overrides,
  };
}
export function helperSetupFixture(overrides: Partial<SetupHelperRead> = {}): SetupHelperRead {
  const setup = ownerSetupFixture();
  return {
    helper_id: HELPER_ID,
    expires_at: "2099-10-13T14:00:00Z",
    serial_number: "SETUP-001",
    generation: setup.generation,
    credential_revision: setup.credential_revision,
    configuration_revision: setup.configuration_revision,
    draft_revision: setup.draft_revision,
    equipment: setup.equipment,
    missing_fields: [],
    checks: setup.checks,
    progress: setup.progress,
    profiles: [setupProfile],
    ...overrides,
  };
}
