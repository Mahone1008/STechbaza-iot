import type { Command } from "../../src/lib/api/commands";
import { diagnosticsFixture, overviewFixture } from "./overview";
export const commandId = "b8f2f2d6-e380-492a-a9dc-d0b9ba792136";
export function controlOverview() {
  const data = overviewFixture();
  data.access.permissions.push("command.read", "command.execute");
  data.command_types = ["vfd.start", "vfd.stop", "vfd.frequency.set"];
  data.frequency_limits = { min_hz: 0, max_hz: 100 };
  data.allowed_commands = [...data.command_types];
  data.modules[3]!.command_types = [...data.command_types]; data.modules[3]!.allowed_commands = [...data.command_types];
  return data;
}
export function commandFixture(changes: Partial<Command> = {}): Command {
  return {
    id: commandId, request_id: "d8f2f2d6-e380-492a-a9dc-d0b9ba792136", device_id: "a8f2f2d6-e380-492a-a9dc-d0b9ba792136",
    command_type: "vfd.start", payload: {}, status: "queued", ttl_seconds: 30,
    expires_at: "2026-09-28T12:00:30.000000Z", created_at: "2026-09-28T12:00:00.000000Z", updated_at: "2026-09-28T12:00:00.000000Z",
    actor_user_id: "0f4ac4a8-6a1d-4d4b-9f91-4c9d5d1a8b31", actor_auth_session_id: "4df58667-7a29-47f8-b6d6-055e47717680",
    actor_organization_id: "670b979d-9e60-5207-a5d2-5d86ee70c71c", actor_platform_role: "user", actor_organization_role: "owner", actor_email: "owner@example.com", actor_display_name: "Оператор тесту",
    published_at: null, publish_attempts: 0, last_publish_attempt_at: null, last_publish_error: null,
    acknowledged_at: null, result_deadline_at: null, result_timed_out_at: null, completed_at: null, result: {}, error_code: null, error_message: null, ...changes,
  };
}


export function programOverview() {
  const data = controlOverview();
  const id = "c41c4b87-b82d-4e35-8faa-000000000009", now = new Date().toISOString();
  data.capabilities.push({ id, code: "vfd.program", name: "Програми роботи", description: null, created_at: now, updated_at: now });
  data.modules.push({ assignment_id: "c41c4b87-b82d-4e35-8faa-000000000019", capability_id: id, code: "vfd.program", supported: true,
    channels: [], command_types: ["vfd.program.start"], allowed_commands: ["vfd.program.start"] });
  data.command_types.push("vfd.program.start"); data.allowed_commands.push("vfd.program.start");
  data.frequency_limits = { min_hz: 20, max_hz: 50 };
  data.diagnostics = { ...diagnosticsFixture(), firmware_version: "0.3.0", last_stop: null, program: {
    version: 1, ready: true, command_id: null, state: "idle", step_index: 0, step_count: 0,
    target_frequency_hz: null, remaining_seconds: null, reason: null,
  } };
  return data;
}
