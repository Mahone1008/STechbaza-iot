import type { components } from "../../src/lib/api/schema";
type Overview = components["schemas"]["DeviceOverviewRead"];
export const overviewDevice = { id: "a8f2f2d6-e380-492a-a9dc-d0b9ba792136", site_id: "739512a9-6ddb-4f8e-99e9-211c8553651e", name: "Насосна станція №1", uid: "TB-TEST-0", device_type: "modular_controller", lifecycle_status: "active", last_seen_at: "2026-09-28T12:00:00Z", created_at: "2026-09-27T12:00:00Z", updated_at: "2026-09-27T12:00:00Z" };
export const overviewOrg = "670b979d-9e60-5207-a5d2-5d86ee70c71c";
export function diagnosticsFixture(): components["schemas"]["ControllerDiagnostics"] {
  return {
    program: null, version: 1, firmware_version: "0.2.2", uptime_ms: 90061000, reset_reason: "brownout",
    connection: { transport: "wifi", signal: { metric: "rssi", dbm: -67 } },
    last_stop: { reason: "network_lost", uptime_ms: 60000, requested_at: null, confirmed: false },
  };
}
export function overviewFixture(device = overviewDevice): Overview {
  const now = new Date().toISOString();
  const entries = [
    { code: "pressure.read", name: "Датчик тиску", channels: [{ key: "pressure.bar", source: "values" as const, data_type: "number" as const, unit: "bar", supports_series: true }] },
    { code: "vfd.state.read", name: "Стан частотника", channels: [
      { key: "pump_running", source: "state" as const, data_type: "boolean" as const, unit: null, supports_series: false },
      { key: "vfd_fault_code", source: "state" as const, data_type: "integer" as const, unit: null, supports_series: false },
    ] },
    { code: "future.module", name: "Майбутній модуль", channels: [] },
    { code: "vfd.control", name: "Керування частотником", channels: [] },
  ];
  const capabilities = entries.map((entry, index) => ({ id: `c41c4b87-b82d-4e35-8faa-${String(index).padStart(12, "0")}`, code: entry.code, name: entry.name, description: null, created_at: now, updated_at: now }));
  return {
    generated_at: now, device, equipment_state: "legacy", equipment_target: null,
    access: { organization_id: overviewOrg, platform_role: "user", organization_role: "owner", permissions: ["device.read", "capability.read", "telemetry.read"] },
    availability: { device_id: device.id, uid: device.uid, online: true, last_seen_at: now, timeout_seconds: 90, seconds_since_seen: 0 },
    capabilities,
    modules: entries.map((entry, index) => ({ assignment_id: `a41c4b87-b82d-4e35-8faa-${String(index).padStart(12, "0")}`, capability_id: capabilities[index]!.id, code: entry.code, supported: index !== 2, channels: entry.channels, command_types: index === 3 ? ["vfd.start", "vfd.stop"] : [], allowed_commands: [] })),
    value_keys: ["pressure.bar"], state_keys: ["pump_running", "vfd_fault_code"], command_types: ["vfd.start", "vfd.stop"], allowed_commands: [], snapshot: null,
    telemetry_freshness: { status: "fresh", reason: "recent", received_at: now, reported_at: now, received_age_seconds: 0, stale_after_seconds: 120 },
    readings: [{ key: "pressure.bar", unit: "bar", value: 0, status: "fresh" }],
    state_readings: [{ key: "pump_running", value: false, status: "fresh" }, { key: "vfd_fault_code", value: 0, status: "fresh" }],
  };
}

export function overviewWithFrequencyFixture(device = overviewDevice) {
  const data = overviewFixture(device);
  const capability = { ...data.capabilities[0]!, id: "c41c4b87-b82d-4e35-8faa-000000000004", code: "vfd.frequency.read", name: "Частота" };
  data.capabilities.push(capability);
  data.modules.push({ assignment_id: "a41c4b87-b82d-4e35-8faa-000000000004", capability_id: capability.id, code: capability.code, supported: true, channels: [{ key: "vfd.frequency_hz", unit: "Hz", source: "values", data_type: "number", supports_series: true }], command_types: [], allowed_commands: [] });
  data.readings.push({ key: "vfd.frequency_hz", unit: "Hz", value: 0, status: "fresh" });
  data.value_keys.push("vfd.frequency_hz");
  return data;
}
