import { describe, expect, it } from "vitest";
import { commandFixture, controlOverview } from "../../../tests/fixtures/commands";
import { overviewDevice, overviewOrg } from "../../../tests/fixtures/overview";
import { commandCursor, commandPending, makeCommandInput, parseCommand, parseCommandPage, parseCommandReceipt, validFrequency } from "./commands";
import { parseOverview } from "./overview";
const row = commandFixture();
const parse = (raw: unknown) => parseCommand(raw, row.device_id, overviewOrg);
describe("command trust and intent boundaries", () => {
  it("validates zero, upper bound, blank and nonfinite frequency without coercing to zero", () => {
    expect(validFrequency("0")).toBe(0); expect(validFrequency("100")).toBe(100); expect(validFrequency("49.5")).toBe(49.5);
    for (const value of ["", " ", "NaN", "Infinity", "-0.1", "100.01", "false"]) expect(validFrequency(value)).toBeNull();
    expect(makeCommandInput("vfd.frequency.set", "0", 5, row.request_id).payload).toEqual({ frequency_hz: 0 });
    expect(makeCommandInput("vfd.stop", "", 300, row.request_id).payload).toEqual({});
    for (const ttl of [0, 4, 301, 5.5, NaN]) expect(() => makeCommandInput("vfd.start", "", ttl, row.request_id)).toThrow();
  });
  it("retains allowed_commands only when root, modules and execute permission agree", () => {
    const data = controlOverview(); expect(parseOverview(data, overviewDevice, overviewOrg).allowedCommands).toHaveLength(3);
    data.allowed_commands = ["vfd.start"]; expect(() => parseOverview(data, overviewDevice, overviewOrg)).toThrow();
    data.allowed_commands = [...data.command_types]; data.access.permissions = data.access.permissions.filter((p) => p !== "command.execute");
    expect(() => parseOverview(data, overviewDevice, overviewOrg)).toThrow();
  });
  it("rejects foreign command, actor organization, invalid status, missing dates and counters", () => {
    for (const change of [{ device_id: overviewOrg }, { actor_organization_id: row.id }, { status: "constructor" }, { ttl_seconds: 301 }, { publish_attempts: -1 }, { expires_at: undefined }, { acknowledged_at: undefined }, { result: null }]) expect(() => parse({ ...row, ...change })).toThrow();
    expect(() => parseCommand(row, row.device_id, overviewOrg, row.request_id)).toThrow();
  });
  it("checks receipt against every immutable input and the authenticated actor", () => {
    const input = makeCommandInput("vfd.start", "", 30, row.request_id);
    expect(parseCommandReceipt(row, row.device_id, overviewOrg, row.actor_user_id!, input)).toEqual(row);
    for (const change of [{ request_id: row.id }, { command_type: "vfd.stop" }, { payload: { frequency_hz: 0 } }, { ttl_seconds: 60 }, { actor_user_id: row.id }]) expect(() => parseCommandReceipt({ ...row, ...change }, row.device_id, overviewOrg, row.actor_user_id!, input)).toThrow();
  });
  it("validates equipment limits and immutable Stop predecessor", () => {
    const data = controlOverview();
    for (const limits of [{ min_hz: 50, max_hz: 20 }, { min_hz: 0, max_hz: Infinity }, { min_hz: "0", max_hz: 50 }]) expect(() => parseOverview({ ...data, frequency_limits: limits }, overviewDevice, overviewOrg)).toThrow();
    expect(parseOverview({ ...data, frequency_limits: null }, overviewDevice, overviewOrg).frequencyLimits).toBeNull();
    const input = { ...makeCommandInput("vfd.stop", "", 30, row.request_id), supersedes_request_id: row.id };
    const receipt = commandFixture({ command_type: "vfd.stop", supersedes_request_id: row.id, control_sequence: 2 });
    expect(parseCommandReceipt(receipt, row.device_id, overviewOrg, row.actor_user_id!, input)).toEqual(receipt);
    expect(() => parseCommandReceipt({ ...receipt, supersedes_request_id: null }, row.device_id, overviewOrg, row.actor_user_id!, input)).toThrow();
    for (const control_sequence of [0, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) expect(() => parse({ ...row, control_sequence })).toThrow();
  });
  it("orders microsecond cursors without rounding timestamps to milliseconds", () => {
    const newer = commandFixture({ created_at: "2026-09-28T12:00:00.123456Z" });
    const older = commandFixture({ id: row.request_id, created_at: "2026-09-28T12:00:00.123455Z" });
    expect(parseCommandPage([older], row.device_id, overviewOrg, commandCursor(newer))).toEqual([older]);
    expect(() => parseCommandPage([newer], row.device_id, overviewOrg, commandCursor(older))).toThrow();
    expect(() => parseCommandPage([older, newer], row.device_id, overviewOrg, null)).toThrow();
  });
  it("validates equal-time ID order, bounded pages, duplicates and cursor exclusions", () => {
    const newer = commandFixture({ id: row.request_id });
    expect(parseCommandPage([newer, row], row.device_id, overviewOrg, null)).toHaveLength(2);
    expect(() => parseCommandPage([row, newer], row.device_id, overviewOrg, null)).toThrow();
    expect(() => parseCommandPage([row, row], row.device_id, overviewOrg, null)).toThrow();
    expect(() => parseCommandPage(Array(22).fill(row), row.device_id, overviewOrg, null)).toThrow();
    expect(() => parseCommandPage([row], row.device_id, overviewOrg, commandCursor(row))).toThrow();
  });
  it("ACK remains pending; unknown result does not become success or auto-retry", () => {
    for (const status of ["queued", "published", "acknowledged"]) expect(commandPending(parse({ ...row, status }))).toBe(true);
    for (const status of ["succeeded", "failed", "expired", "result_unknown", "cancelled"]) expect(commandPending(parse({ ...row, status }))).toBe(false);
  });
});

