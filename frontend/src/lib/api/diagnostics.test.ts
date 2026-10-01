import { describe, expect, it } from "vitest";
import { diagnosticsFixture, overviewDevice, overviewFixture, overviewOrg } from "../../../tests/fixtures/overview";
import { parseDiagnostics, uptimeText } from "./diagnostics";
import { effectiveQuality, parseOverview } from "./overview";

describe("controller diagnostics", () => {
  it("accepts absent diagnostics from an older firmware/API", () => {
    expect(parseDiagnostics(undefined)).toBeNull();
    expect(parseDiagnostics(null)).toBeNull();
    expect(parseOverview(overviewFixture(), overviewDevice, overviewOrg).diagnostics).toBeNull();
  });
  it("preserves false, missing UTC, and uptime beyond the millis wrap", () => {
    const value = diagnosticsFixture(); value.uptime_ms = 2 ** 32 + 1000;
    expect(parseDiagnostics(value)).toEqual(value);
    expect(uptimeText(0)).toBe("0 год 0 хв 0 с");
    expect(uptimeText(90061000)).toBe("1 д 1 год 1 хв 1 с");
    expect(uptimeText(value.uptime_ms)).toMatch(/^49 д /);
  });
  it("uses measured signal semantics for each transport", () => {
    const data = diagnosticsFixture();
    for (const connection of [
      { transport: "cellular", signal: { metric: "rsrp", dbm: -105 } },
      { transport: "ethernet", signal: null }, { transport: "wifi", signal: null },
    ]) expect(parseDiagnostics({ ...data, connection })?.connection).toEqual(connection);
  });
  it("rejects malformed diagnostics and prototype keys", () => {
    const data = diagnosticsFixture();
    for (const change of [
      { version: true }, { version: 2 }, { uptime_ms: -1 }, { uptime_ms: 2 ** 53 },
      { uptime_ms: "20" }, { firmware_version: "<script>" }, { reset_reason: "__proto__" },
      { connection: { transport: "constructor" } },
      { connection: { transport: "wifi", signal: { metric: "rsrp", dbm: -70 } } },
      { connection: { transport: "ethernet", signal: { metric: "rssi", dbm: -70 } } },
      { connection: { transport: "wifi", signal: { metric: "rssi", dbm: -128 } } },
      { last_stop: { ...data.last_stop, confirmed: "false" } },
      { last_stop: { ...data.last_stop, uptime_ms: data.uptime_ms + 1 } },
    ]) expect(() => parseDiagnostics({ ...data, ...change })).toThrow();
  });
  it("shares freshness with telemetry, including a previous controller session", () => {
    const data = overviewFixture(); data.diagnostics = diagnosticsFixture();
    data.telemetry_freshness.status = "stale"; data.telemetry_freshness.reason = "session_changed";
    for (const reading of [...data.readings, ...data.state_readings]) reading.status = "stale";
    const parsed = parseOverview(data, overviewDevice, overviewOrg);
    expect(parsed.diagnostics).toEqual(data.diagnostics);
    expect(effectiveQuality(parsed.freshness.status, parsed.freshness, 0)).toBe("stale");
  });
});
