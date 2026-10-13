import { describe, expect, it } from "vitest";
import type { components } from "@/lib/api";
import { factoryEquipmentDraft, validateFactoryEquipment, type FactoryEquipmentDraft } from "./factory-equipment-model";

const profile: components["schemas"]["ProfileRead"] = {
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
const draft = (): FactoryEquipmentDraft => ({
  ...factoryEquipmentDraft(),
  supply: "cabinet",
  series: "SU600",
  model: "SU600A-5RG1-B",
  motorAttached: true,
  ratedFrequency: "50",
  minHz: "30",
  maxHz: "50",
  reviewed: true,
});

describe("manufacturer equipment preparation", () => {
  it("lets controller-only registration proceed without inventing a motor or requesting the catalogue", () => {
    expect(validateFactoryEquipment(factoryEquipmentDraft(), undefined)).toEqual({
      equipment: null,
      valid: true,
      error: null,
    });
    expect(factoryEquipmentDraft().ratedFrequency).toBe("");
    expect(factoryEquipmentDraft().reviewed).toBe(false);
  });

  it("requires an exact full model and a driver, even when the chosen series is correct", () => {
    expect(validateFactoryEquipment({ ...draft(), model: "S123456789" }, [profile]).valid).toBe(false);
    expect(validateFactoryEquipment(draft(), [{ ...profile, driver_id: null }]).valid).toBe(false);
    expect(validateFactoryEquipment(draft(), [{ ...profile, manufacturer: "SIGMA" }]).valid).toBe(false);
  });

  it("prepares actual motor data and limits without turning preparation into physical acceptance", () => {
    const result = validateFactoryEquipment({ ...draft(), model: " su600a-5rg1-b ", ratedCurrent: "1.5" }, [profile]);
    expect(result.valid).toBe(true);
    expect(result.equipment).toMatchObject({
      profile_id: profile.id,
      profile_version: 1,
      model: "su600a-5rg1-b",
      frequency_limits: { min_hz: 30, max_hz: 50 },
      motor: { rated_frequency_hz: 50, rated_current_a: 1.5 },
    });
    expect(result.equipment).not.toHaveProperty("installation_checked");
    expect(result.equipment).not.toHaveProperty("control_enabled");
  });

  it.each([
    { ratedFrequency: "" },
    { ratedFrequency: "40" },
    { ratedCurrent: "NaN" },
    { ratedPower: "-1" },
    { minHz: "" },
    { minHz: "50" },
    { maxHz: "51" },
    { maxHz: "Infinity" },
    { maxHz: "49.999" },
    { reviewed: false },
  ])("refuses missing, unsafe or unreviewed data: %j", (change) => {
    expect(validateFactoryEquipment({ ...draft(), ...change }, [profile]).valid).toBe(false);
  });

  it("preserves a prepared passport but requires a fresh review when it is edited", () => {
    const equipment = validateFactoryEquipment(draft(), [profile]).equipment;
    expect(equipment).not.toBeNull();
    const restored = factoryEquipmentDraft(equipment);
    expect(restored.model).toBe(profile.tested_model);
    expect(restored.ratedFrequency).toBe("50");
    expect(validateFactoryEquipment(restored, [profile], equipment).valid).toBe(false);
    expect(validateFactoryEquipment({ ...restored, reviewed: true }, [profile], equipment).valid).toBe(true);
  });
});
