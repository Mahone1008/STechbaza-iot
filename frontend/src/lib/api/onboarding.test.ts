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
  it("does not grant installer access or installation readiness to a legacy response", () => {
    const value = parseConnection(connection, id);
    expect(value.can_install).toBe(false);
    expect(value.can_invite_installer).toBe(false);
    expect(value.organization_id).toBeNull();
    expect(value.readiness.state).toBe("blocked");
    expect(() => parseConnection({ ...connection, can_install: "yes" }, id)).toThrow();
    expect(() => parseConnection({ ...connection, can_invite_installer: true }, id)).toThrow();
  });
  it("requires live telemetry, claimed ownership and no blockers for completed readiness", () => {
    const ready = {
      state: "ready",
      title: "Готово до використання",
      next_action: null,
      blockers: [],
    };
    const live = {
      ...connection,
      state: "claimed",
      device_id: device,
      site_id: "739512a9-6ddb-4f8e-99e9-211c8553651e",
      connection_state: "online",
      telemetry_received_at: "2026-10-12T10:00:00Z",
      readiness: ready,
      can_install: false,
    };
    expect(parseConnection(live, id).readiness.state).toBe("ready");
    expect(() => parseConnection({ ...connection, readiness: ready }, id)).toThrow();
    expect(() => parseConnection({ ...live, connection_state: "bootstrap_connected" }, id)).toThrow();
    expect(() =>
      parseConnection({ ...live, readiness: { ...ready, blockers: ["Монтаж не перевірено"] } }, id),
    ).toThrow();
    expect(() => parseConnection({ ...live, readiness: { ...ready, state: "almost_ready" } }, id)).toThrow();
    expect(() => parseConnection({ ...live, readiness: { ...ready, blockers: [false] } }, id)).toThrow();
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
