import { describe, expect, it } from "vitest";
import { parameterWord, parseVfdSettings, sourceLabel } from "./vfd-settings";

const fixture = {
  version: 1,
  driver_id: "su600",
  ready: true,
  command_sequence: 5,
  run_source: 2,
  frequency_source: 6,
  parameters: { "F0.10": 75, "F0.11": 75 },
};

describe("model-specific VFD settings", () => {
  it("keeps absence compatible and never guesses a source", () => {
    expect(parseVfdSettings(null)).toBeNull();
    expect(sourceLabel(parseVfdSettings(fixture))).toBe("Дистанційне");
    expect(sourceLabel(parseVfdSettings({ ...fixture, run_source: 0, frequency_source: 1 }))).toContain("Місцеве");
    expect(sourceLabel(parseVfdSettings({ ...fixture, run_source: null }))).toBe("Не підтверджено");
    expect(sourceLabel(parseVfdSettings({ ...fixture, run_source: 2, frequency_source: 1 }))).toContain(
      "відрізняються",
    );
  });
  it("rejects bad drivers, malformed readback and arbitrary parameters", () => {
    for (const raw of [
      { ...fixture, driver_id: "su300" },
      { ...fixture, command_sequence: -1 },
      { ...fixture, parameters: { ...fixture.parameters, "F5.00": 0 } },
      { ...fixture, parameters: { "F0.10": true, "F0.11": 75 } },
    ])
      expect(() => parseVfdSettings(raw)).toThrow();
  });
  it("validates decimal seconds without rounding extra precision", () => {
    expect(parameterWord("7,5")).toBe(75);
    expect(parameterWord("0.1")).toBe(1);
    expect(parameterWord("999.9")).toBe(9999);
    for (const value of ["", "0", "-1", "1.25", "1e2", "Infinity", "1000"]) expect(parameterWord(value)).toBeNull();
  });
});
