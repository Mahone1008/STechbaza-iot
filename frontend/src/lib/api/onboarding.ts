import { invalidResponse, isRecord, requiredDateTime, requiredString, requiredUuid } from "./access";
import type { components } from "./schema";
import { equipmentState } from "./equipment";
import { parseReadiness, type InstallationReadiness } from "./readiness";

const path = "/api/v1/connect";
export type Connection = components["schemas"]["ConnectionRead"] & {
  readiness: InstallationReadiness;
  can_install: boolean;
  organization_id: string | null;
  can_invite_installer: boolean;
  can_setup: boolean;
};
export function parseConnection(value: unknown, controllerId: string): Connection {
  if (!isRecord(value) || value.controller_id !== controllerId || !["ready", "claimed"].includes(String(value.state)))
    return invalidResponse(path, "controller identity and state");
  const claimed = value.state === "claimed";
  if (!claimed && (value.device_id !== null || value.site_id !== null))
    return invalidResponse(path, "unclaimed controller");
  const transport = value.network_transport ?? "wifi";
  const contactTransport = value.last_contact_transport ?? null;
  const connectionState = value.connection_state ?? (value.last_contact_at ? "bootstrap_connected" : "not_connected");
  if (
    !["wifi", "lte"].includes(String(transport)) ||
    (contactTransport !== null && !["wifi", "lte"].includes(String(contactTransport)))
  )
    return invalidResponse(path, "controller transport");
  if (
    !["not_connected", "transport_mismatch", "bootstrap_connected", "online", "offline"].includes(
      String(connectionState),
    )
  )
    return invalidResponse(path, "controller connection state");
  if (connectionState === "online" && value.telemetry_received_at == null)
    return invalidResponse(path, "live controller telemetry");
  if (value.initial_equipment_editable !== undefined && typeof value.initial_equipment_editable !== "boolean")
    return invalidResponse(path, "initial equipment editing");
  if (value.can_install !== undefined && typeof value.can_install !== "boolean")
    return invalidResponse(path, "installation permission");
  if (value.can_invite_installer !== undefined && typeof value.can_invite_installer !== "boolean")
    return invalidResponse(path, "installer invitation permission");
  if (value.can_setup !== undefined && typeof value.can_setup !== "boolean")
    return invalidResponse(path, "owner setup permission");
  if (value.can_setup === true && !claimed) return invalidResponse(path, "claimed owner setup");
  const organizationId = value.organization_id == null ? null : requiredUuid(value, "organization_id", path);
  if (value.can_invite_installer === true && (!claimed || !organizationId))
    return invalidResponse(path, "installer invitation scope");
  const readiness = parseReadiness(value.readiness, path);
  if (readiness.state === "ready" && (!claimed || connectionState !== "online" || readiness.blockers.length > 0))
    return invalidResponse(path, "confirmed installation readiness");
  return {
    readiness,
    can_install: value.can_install === true,
    organization_id: organizationId,
    can_invite_installer: value.can_invite_installer === true,
    can_setup: value.can_setup === true,
    controller_id: requiredUuid(value, "controller_id", path),
    serial_number: requiredString(value, "serial_number", path),
    hardware_model: requiredString(value, "hardware_model", path),
    state: claimed ? "claimed" : "ready",
    device_id: claimed ? requiredUuid(value, "device_id", path) : null,
    site_id: claimed ? requiredUuid(value, "site_id", path) : null,
    last_contact_at: value.last_contact_at === null ? null : requiredDateTime(value, "last_contact_at", path),
    firmware_version: value.firmware_version === null ? null : requiredString(value, "firmware_version", path),
    activation_required: value.activation_required === false ? false : true,
    permanent_login: value.permanent_login == null ? null : requiredString(value, "permanent_login", path),
    network_transport: transport as "wifi" | "lte",
    last_contact_transport: contactTransport as "wifi" | "lte" | null,
    telemetry_received_at:
      value.telemetry_received_at == null ? null : requiredDateTime(value, "telemetry_received_at", path),
    connection_state: connectionState as components["schemas"]["ConnectionRead"]["connection_state"],
    initial_equipment_editable: value.initial_equipment_editable === true,
  };
}

export type ConnectionEquipment = {
  module: { id: string; manufacturer: string; series: string; model: string; hardware_revision: string | null } | null;
  configuration_state: components["schemas"]["EquipmentPassport"]["configuration_state"];
  configured: boolean;
};
export function parseConnectionEquipment(value: unknown, deviceId: string, controllerId: string): ConnectionEquipment {
  if (
    !isRecord(value) ||
    value.device_id !== deviceId ||
    value.controller_id !== controllerId ||
    !Array.isArray(value.modules) ||
    value.modules.length > 32
  )
    return invalidResponse(path, "controller equipment identity");
  if (value.modules.some((item) => !isRecord(item))) return invalidResponse(path, "equipment module");
  const modules = value.modules.filter((item) => isRecord(item) && item.kind === "vfd" && item.retired_at === null);
  if (modules.length > 1) return invalidResponse(path, "active controller drive");
  const item = modules[0];
  let installedModule: ConnectionEquipment["module"] = null;
  if (item) {
    if (!isRecord(item) || item.device_id !== deviceId) return invalidResponse(path, "drive identity");
    installedModule = {
      id: requiredUuid(item, "id", path),
      manufacturer: requiredString(item, "manufacturer", path),
      series: requiredString(item, "series", path),
      model: requiredString(item, "model", path),
      hardware_revision: item.hardware_revision == null ? null : requiredString(item, "hardware_revision", path),
    };
  }
  if (value.desired !== null && !isRecord(value.desired)) return invalidResponse(path, "saved equipment configuration");
  const configurationState = equipmentState(value.configuration_state);
  if (configurationState === "verified" && value.desired === null)
    return invalidResponse(path, "verified equipment configuration");
  return { module: installedModule, configuration_state: configurationState, configured: value.desired !== null };
}
export function parseRecovery(value: unknown): string {
  if (!isRecord(value) || typeof value.recovery_key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.recovery_key))
    return invalidResponse("/api/v1/auth/recovery", "recovery key");
  return value.recovery_key;
}
