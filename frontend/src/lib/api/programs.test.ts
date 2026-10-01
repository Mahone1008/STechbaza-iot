import { describe, expect, it } from "vitest";
import { draftPlan, emptyProgramStep } from "@/features/program-settings";
import { makeCommandInput, parseCommandReceipt } from "./commands";
import { parseProgramPlan, parseProgramProgress, programActive, sameProgram } from "./programs";
import { commandFixture, programOverview } from "../../../tests/fixtures/commands";
import { overviewOrg } from "../../../tests/fixtures/overview";

describe("controller programs", () => {
  const plan = { version: 1, steps: [{ frequency_hz: 40, duration_seconds: 7200 }, { frequency_hz: 50, duration_seconds: 3600 }] } as const;
  it("keeps TTL separate and verifies a deserialized nested receipt", () => {
    const parsed = parseProgramPlan(plan)!;
    const command = commandFixture();
    const input = makeCommandInput("vfd.program.start", "", 30, command.request_id, parsed);
    const receipt = JSON.parse(JSON.stringify({ ...command, ...input }));
    expect(input.ttl_seconds).toBe(30);
    expect(parseCommandReceipt(receipt, command.device_id, overviewOrg, command.actor_user_id!, input).payload).toEqual(parsed);
    receipt.payload.steps[0].duration_seconds++;
    expect(() => parseCommandReceipt(receipt, command.device_id, overviewOrg, command.actor_user_id!, input)).toThrow();
  });
  it("rejects unsupported or unbounded plans", () => {
    for (const value of [null, { ...plan, version: true }, { ...plan, steps: [] }, { ...plan, steps: [...plan.steps, ...plan.steps, ...plan.steps, ...plan.steps, ...plan.steps] },
      ...[0, 100.01, NaN, true, "40", 20.001].map((frequency_hz) => ({ version: 1, steps: [{ frequency_hz, duration_seconds: 10 }] })),
      ...[0, 9, 86401, true, "10", 10.5].map((duration_seconds) => ({ version: 1, steps: [{ frequency_hz: 40, duration_seconds }] })),
      { ...plan, steps: [{ frequency_hz: 40, duration_seconds: 86400 }, { frequency_hz: 50, duration_seconds: 10 }] }]) expect(parseProgramPlan(value)).toBeNull();
    expect(sameProgram(plan, JSON.parse(JSON.stringify(plan)))).toBe(true);
  });
  it("builds hours/minutes/seconds and keeps a timer to one stage", () => {
    const row = { ...emptyProgramStep(0), frequency: "40", hours: "2", minutes: "0", seconds: "10" };
    expect(draftPlan("timer", [row, { ...row, id: 1 }])?.steps).toEqual([{ frequency_hz: 40, duration_seconds: 7210 }]);
    expect(draftPlan("program", [row, { ...row, id: 1 }])?.steps).toHaveLength(2);
    for (const change of [{ hours: "" }, { minutes: "60" }, { seconds: "1.5" }, { hours: "-1" }, { frequency: "" }]) expect(draftPlan("timer", [{ ...row, ...change }])).toBeNull();
  });
  it("validates status identity, types and stage bounds", () => {
    const idle = programOverview().diagnostics!.program!;
    expect(parseProgramProgress(idle)).toEqual(idle);
    expect(programActive(idle)).toBe(false);
    for (const change of [{ version: true }, { ready: 1 }, { state: "holding" }, { step_index: 1 }, { target_frequency_hz: true }, { remaining_seconds: -1 }]) expect(() => parseProgramProgress({ ...idle, ...change })).toThrow();
    expect(parseProgramProgress(undefined)).toBeNull();
  });
  it("reads week-long progress and defaults legacy firmware to one day", () => {
    const idle = programOverview().diagnostics!.program!;
    const legacy = { ...idle, max_schedule_seconds: undefined };
    expect(parseProgramProgress(legacy)?.max_schedule_seconds).toBe(86400);
    const progress = { ...idle, max_schedule_seconds: 604800, state: "holding", command_id: commandFixture().id, step_index: 1, step_count: 1, target_frequency_hz: 40, remaining_seconds: 604800 };
    expect(parseProgramProgress(progress)?.remaining_seconds).toBe(604800);
    for (const max_schedule_seconds of [true, 604801, 0, "604800"]) expect(() => parseProgramProgress({ ...idle, max_schedule_seconds })).toThrow();
    expect(() => parseProgramProgress({ ...progress, remaining_seconds: 604801 })).toThrow();
  });
});
