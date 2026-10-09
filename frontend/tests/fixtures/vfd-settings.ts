import { programOverview } from "./commands";
export function settingsOverview() {
  const data = programOverview();
  data.command_types.push("vfd.source.set", "vfd.parameter.set");
  data.allowed_commands.push("vfd.source.set");
  data.modules[3]!.command_types.push("vfd.source.set", "vfd.parameter.set");
  data.modules[3]!.allowed_commands.push("vfd.source.set");
  data.diagnostics!.vfd_settings = {
    version: 1,
    driver_id: "su600",
    ready: true,
    command_sequence: 0,
    run_source: 2,
    frequency_source: 6,
    parameters: { "F0.10": 75, "F0.11": 75 },
  };
  return data;
}
