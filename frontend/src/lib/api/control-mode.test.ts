import { describe, expect, it } from "vitest";
import { overviewDevice, overviewFixture, overviewOrg } from "../../../tests/fixtures/overview";
import { parseControlMode } from "./control-mode";
import { parseOverview } from "./overview";
import { parseCommandReceipt } from "./commands";
import { commandFixture } from "../../../tests/fixtures/commands";

const mode = { device_id: overviewDevice.id, mode: "manual", revision: 0, changed_at: null, enabled_schedule_count: 0, next_start_at: null };
describe("saved control mode boundary", () => {
  it("preserves manual, zero revision and old API absence", () => {
    expect(parseControlMode(mode, overviewDevice.id)).toEqual(mode);
    expect(parseControlMode(undefined, overviewDevice.id)).toBeNull();
    const overview = parseOverview({ ...overviewFixture(), control_mode: mode }, overviewDevice, overviewOrg);
    expect(overview.controlMode?.mode).toBe("manual");
  });
  it("rejects other devices, invalid modes, timestamps and unsafe counters", () => {
    for (const change of [{ device_id: overviewOrg }, { mode: "local" }, { mode: "constructor" }, { revision: true }, { revision: -1 }, { revision: 2 ** 32 },
      { enabled_schedule_count: 51 }, { enabled_schedule_count: "1" }, { next_start_at: "tomorrow" }, { changed_at: undefined }])
      expect(() => parseControlMode({ ...mode, ...change }, overviewDevice.id)).toThrow();
  });
  it("receipt confirms the immutable requested revision rather than the updated mode", () => {
    const input = { request_id: "d8f2f2d6-e380-492a-a9dc-d0b9ba792136", command_type: "vfd.start" as const, payload: {}, ttl_seconds: 30, expected_control_mode_revision: 3 };
    const command = commandFixture({ control_mode_revision: 4, requested_control_mode_revision: 3 });
    expect(parseCommandReceipt(command, overviewDevice.id, overviewOrg, command.actor_user_id!, input).id).toBe(command.id);
    expect(() => parseCommandReceipt({ ...command, requested_control_mode_revision: 4 }, overviewDevice.id, overviewOrg, command.actor_user_id!, input)).toThrow();
  });
});
