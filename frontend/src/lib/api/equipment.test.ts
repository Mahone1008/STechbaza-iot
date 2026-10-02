import { describe, expect, it } from "vitest";
import { overviewDevice, overviewFixture, overviewOrg } from "../../../tests/fixtures/overview";
import { equipmentState, parseEquipmentPassport } from "./equipment";
import { controlBlockReason, parseOverview } from "./overview";

const passport = () => ({ device_id: overviewDevice.id, controller_uid: overviewDevice.uid, firmware_version: null,
  installations: [], modules: [], desired: null, reported: null, configuration_state: "legacy" });
describe("equipment passport and command admission", () => {
  it("accepts the empty legacy passport but rejects another controller and impossible confirmation", () => {
    expect(parseEquipmentPassport(passport(), overviewDevice).modules).toEqual([]);
    for (const changes of [{ device_id: overviewOrg }, { controller_uid: "foreign" }, { configuration_state: "verified" },
      { configuration_state: "future" }, { modules: [{}] }]) {
      expect(() => parseEquipmentPassport({ ...passport(), ...changes }, overviewDevice)).toThrow();
    }
    expect(() => equipmentState("__proto__")).toThrow();
  });
  it("blocks mismatched equipment even without the optional diagnostics capability", () => {
    const data = overviewFixture(); data.equipment_state = "mismatch";
    expect(controlBlockReason(parseOverview(data, overviewDevice, overviewOrg))).toContain("відрізняється");
    data.equipment_state = "awaiting";
    expect(controlBlockReason(parseOverview(data, overviewDevice, overviewOrg))).toContain("не підтвердив");
  });
});
