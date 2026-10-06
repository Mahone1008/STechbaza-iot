import { describe, expect, it } from "vitest";
import { overviewDevice, overviewFixture, overviewOrg } from "../../../tests/fixtures/overview";
import { channelLabel, controlBlockReason, effectiveQuality, parseOverview, readingText, type Overview } from "./overview";
const parse = (value: unknown) => parseOverview(value, overviewDevice, overviewOrg);
describe("module overview boundary", () => {
  it("gates only installed VFD diagnostics, refuses stale or missing ARM, and does not invent sensors", () => {
    const base = parse(overviewFixture());
    expect(controlBlockReason(base)).toBeNull();
    const data: Overview = { ...base, modules: [...base.modules, {
      assignmentId: "diagnostics", code: "vfd.diagnostics.read", name: "V3", supported: true, commands: [], allowedCommands: [],
      channels: ["vfd_link", "vfd_configuration_valid", "control_armed"].map((key) => ({ key, source: "state", data_type: "boolean", unit: null, status: "fresh", value: true })),
    }] };
    expect(controlBlockReason(data)).toBeNull();
    expect(controlBlockReason(data, 121)).toContain("свіжу діагностику");
    const diagnostics = data.modules.at(-1)!;
    const withoutArm = diagnostics.channels.filter((channel) => channel.key !== "control_armed");
    const arm = diagnostics.channels.at(-1)!;
    expect(controlBlockReason({ ...data, modules: [{ ...diagnostics, channels: [...withoutArm, { ...arm, value: false }] }] })).toContain("Контролер ще не дозволив керування");
    expect(controlBlockReason({ ...data, modules: [{ ...diagnostics, channels: [...withoutArm, { ...arm, status: "missing", value: null }] }] })).toContain("свіжу діагностику");
    expect(controlBlockReason({ ...data, modules: [{ ...diagnostics, channels: withoutArm }] })).toContain("свіжу діагностику");
  });
  it("preserves zero, false, units, assignments and unsupported modules", () => {
    const data = parse(overviewFixture());
    expect(data.modules[0]!.channels[0]!.value).toBe(0);
    expect(data.modules[0]!.channels[0]!.unit).toBe("bar");
    expect(readingText(data.modules[1]!.channels[0]!)).toBe("Ні");
    expect(readingText(data.modules[1]!.channels[1]!)).toBe("0");
    expect(data.modules[2]!.supported).toBe(false);
    expect(data.modules[3]!.channels).toEqual([]);
  });
  it.each(["missing", "invalid"] as const)("keeps %s null rather than zero", (status) => {
    const data = overviewFixture(); data.readings[0] = { ...data.readings[0]!, status, value: null };
    expect(readingText(parse(data).modules[0]!.channels[0]!)).toBe("-");
    data.readings[0]!.value = 0; expect(() => parse(data)).toThrow();
  });
  it("rejects wrong device, parent, organization, unit and unassigned readings", () => {
    for (const modify of [
      (d: ReturnType<typeof overviewFixture>) => { d.device = { ...d.device, id: overviewOrg }; },
      (d: ReturnType<typeof overviewFixture>) => { d.device = { ...d.device, site_id: overviewOrg }; },
      (d: ReturnType<typeof overviewFixture>) => { d.access.organization_id = overviewDevice.id; },
      (d: ReturnType<typeof overviewFixture>) => { d.readings[0]!.unit = "Hz"; },
      (d: ReturnType<typeof overviewFixture>) => { d.readings.push({ key: "unassigned", unit: "bar", status: "fresh", value: 20 }); },
    ]) { const data = overviewFixture(); modify(data); expect(() => parse(data)).toThrow(); }
  });
  it("rejects nonfinite numbers, wrong state types and unsafe integers", () => {
    const data = overviewFixture(); data.readings[0]!.value = Infinity; expect(() => parse(data)).toThrow();
    data.readings[0]!.value = 1; data.state_readings[0]!.value = 0; expect(() => parse(data)).toThrow();
    data.state_readings[0]!.value = false; data.state_readings[1]!.value = 2 ** 53; expect(() => parse(data)).toThrow();
  });
  it("does not coerce malformed quality tags or inherit labels from Object.prototype", () => {
    const data = overviewFixture();
    expect(() => parse({ ...data, readings: [{ ...data.readings[0], status: ["fresh"] }] })).toThrow();
    expect(() => parse({ ...data, telemetry_freshness: { ...data.telemetry_freshness, reason: ["recent"] } })).toThrow();
    expect(channelLabel("constructor")).toBe("constructor");
    expect(channelLabel("__proto__")).toBe("__proto__");
  });
  it("rejects duplicate assignments and channel keys", () => {
    const data = overviewFixture(); data.modules.push(data.modules[0]!); expect(() => parse(data)).toThrow();
    data.modules.pop(); data.modules[0]!.channels.push(data.modules[0]!.channels[0]!); expect(() => parse(data)).toThrow();
  });
  it("disabled module does not return from old raw snapshot fields", () => {
    const data = overviewFixture(); data.capabilities.shift(); data.modules.shift(); data.readings = [];
    const parsed = parse({ ...data, snapshot: { values: { "pressure.bar": 999 }, config: { secret: "never-render" } } });
    expect(JSON.stringify(parsed)).not.toContain("999"); expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parsed.modules).toHaveLength(3);
  });
  it("ages fresh readings conservatively, including report delay", () => {
    const q = overviewFixture().telemetry_freshness;
    expect(effectiveQuality("fresh", q, 121)).toBe("stale");
    expect(effectiveQuality("missing", q, 121)).toBe("missing");
    q.reported_at = new Date(Date.parse(q.received_at!) - 60_000).toISOString();
    expect(effectiveQuality("fresh", q, 61)).toBe("stale");
    q.status = "stale"; q.reason = "session_changed";
    expect(effectiveQuality("fresh", q, 0)).toBe("stale");
  });
  it("unknown channel types degrade to unsupported without casting raw values", () => {
    const data = overviewFixture();
    const raw = { ...data, modules: data.modules.map((m, index) => index ? m : { ...m, channels: [{ ...m.channels[0], data_type: "future-object" }] }) };
    expect(parse(raw).modules[0]!.channels[0]!.value).toBe(null);
  });
  it("refuses fresh readings from an old controller session", () => {
    const data = overviewFixture(); data.telemetry_freshness.status = "stale"; data.telemetry_freshness.reason = "session_changed";
    expect(() => parse(data)).toThrow();
    for (const row of [...data.readings, ...data.state_readings]) row.status = "stale";
    expect(parse(data).freshness.reason).toBe("session_changed");
  });
});
