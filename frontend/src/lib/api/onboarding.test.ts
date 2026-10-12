import { describe, expect, it } from "vitest";
import { parseConnection, parseConnectionEquipment } from "./onboarding";

const id = "017ca46d-342c-4ab6-bd1c-89a602021951";
const device = "44444444-4444-4444-8444-444444444444";
const connection = {
  controller_id: id,
  serial_number: "TEST-ONLY",
  hardware_model: "KERUMO V4",
  state: "ready",
  device_id: null,
  site_id: null,
  last_contact_at: null,
  firmware_version: null,
};

describe("factory connection boundaries", () => {
  it("does not infer live telemetry from an authenticated bootstrap contact", () => {
    const value = parseConnection(
      {
        ...connection,
        network_transport: "lte",
        last_contact_at: "2026-10-12T10:00:00Z",
        connection_state: "bootstrap_connected",
      },
      id,
    );
    expect(value.network_transport).toBe("lte");
    expect(value.connection_state).toBe("bootstrap_connected");
    expect(value.telemetry_received_at).toBeNull();
    expect(value.initial_equipment_editable).toBe(false);
    expect(() => parseConnection({ ...connection, connection_state: "online" }, id)).toThrow();
  });
  it("rejects unknown transport and states while preserving legacy Wi-Fi responses", () => {
    expect(parseConnection(connection, id).network_transport).toBe("wifi");
    expect(() => parseConnection({ ...connection, network_transport: "satellite" }, id)).toThrow();
    expect(() => parseConnection({ ...connection, last_contact_transport: "bad" }, id)).toThrow();
    expect(() => parseConnection({ ...connection, connection_state: "ready_to_start" }, id)).toThrow();
    expect(() => parseConnection({ ...connection, initial_equipment_editable: "true" }, id)).toThrow();
  });
  it("never hydrates a passport from another controller or two active drives", () => {
    const drive = {
      id: device,
      device_id: device,
      kind: "vfd",
      retired_at: null,
      manufacturer: "SUSWE",
      series: "SU600",
      model: "SU600A-5RG1-B",
      hardware_revision: null,
    };
    const equipment = {
      device_id: device,
      controller_id: id,
      modules: [drive],
      desired: null,
      configuration_state: "legacy",
    };
    expect(parseConnectionEquipment(equipment, device, id).module?.model).toBe(drive.model);
    expect(() => parseConnectionEquipment({ ...equipment, controller_id: device }, device, id)).toThrow();
    expect(() => parseConnectionEquipment({ ...equipment, modules: [drive, drive] }, device, id)).toThrow();
    expect(() => parseConnectionEquipment({ ...equipment, modules: [null] }, device, id)).toThrow();
  });
});
