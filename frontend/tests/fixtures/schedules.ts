import { programOverview } from "./commands";

export function scheduleOverview() {
  const data = programOverview(),
    now = new Date().toISOString();
  const cap = "f7d6f82e-ea2f-4b91-8ee9-003b19c183d6";
  data.capabilities.push({
    id: cap,
    code: "vfd.schedule",
    name: "Календарні запуски",
    description: null,
    created_at: now,
    updated_at: now,
  });
  data.modules.push({
    assignment_id: "f7d6f82e-ea2f-4b91-8ee9-003b19c183d5",
    capability_id: cap,
    code: "vfd.schedule",
    supported: true,
    channels: [],
    command_types: ["vfd.schedule.start"],
    allowed_commands: ["vfd.schedule.start"],
  });
  data.command_types.push("vfd.schedule.start");
  data.allowed_commands.push("vfd.schedule.start");
  data.diagnostics!.program!.supports_schedule = true;
  data.diagnostics!.program!.max_schedule_seconds = 604800;
  return data;
}
