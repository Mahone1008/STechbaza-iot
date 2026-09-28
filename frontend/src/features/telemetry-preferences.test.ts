import { afterEach, describe, expect, it, vi } from "vitest";
import { contextStorageKey, forgetContext } from "./inventory-context";
import { historyPreferencesKey, normalizeHistorySelection, readHistorySelection, saveHistorySelection } from "./telemetry-preferences";

const channels = [{ key: "pressure.bar", unit: "bar", source: "values", data_type: "number" }, { key: "vfd.frequency_hz", unit: "Hz", source: "values", data_type: "number" }];
const defaults = { metric: "pressure.bar", seconds: 3600, bucket: 60 };
const selected = { metric: "vfd.frequency_hz", seconds: 21600, bucket: 900 };
const scope = { userId: "user-a", sessionId: "session-a" };
afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const values: Record<string, string> = {};
  Object.defineProperties(values, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: { value: (key: string, value: string) => { values[key] = value; } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
  vi.stubGlobal("sessionStorage", values);
  return values;
}

describe("history preferences", () => {
  it("restores all three explicit selections without replacing the chosen bucket", () => {
    memoryStorage(); saveHistorySelection("history", selected);
    expect(readHistorySelection("history", channels)).toEqual(selected);
  });
  it("falls back on corrupt JSON and invalid stored types", () => {
    const values = memoryStorage(); values.history = "{";
    expect(readHistorySelection("history", channels)).toEqual(defaults);
    for (const raw of [null, [], "bad", { metric: {}, seconds: "21600", bucket: "900" }, { seconds: -1, bucket: 0 }]) {
      expect(normalizeHistorySelection(raw, channels)).toEqual(defaults);
    }
  });
  it("rejects unavailable metrics using the current device channels", () => {
    expect(normalizeHistorySelection(selected, [channels[0]!])).toEqual({ ...selected, metric: "pressure.bar" });
    expect(normalizeHistorySelection(selected, [])).toEqual({ ...selected, metric: "" });
  });
  it("bounds restored intervals to supported values and the 1000-bucket limit", () => {
    for (const bucket of [60, 300, 1, 0, Infinity]) {
      expect(normalizeHistorySelection({ ...selected, seconds: 604800, bucket }, channels).bucket).toBe(3600);
    }
    expect(normalizeHistorySelection({ ...selected, seconds: 604800, bucket: 900 }, channels).bucket).toBe(900);
  });
  it("isolates stored preferences across users, sessions, organizations and devices", () => {
    memoryStorage(); const key = historyPreferencesKey(scope, "org-a", "device-a");
    saveHistorySelection(key, selected);
    const alternatives = [historyPreferencesKey({ ...scope, userId: "user-b" }, "org-a", "device-a"), historyPreferencesKey({ ...scope, sessionId: "session-b" }, "org-a", "device-a"), historyPreferencesKey(scope, "org-b", "device-a"), historyPreferencesKey(scope, "org-a", "device-b")];
    for (const other of alternatives) expect(readHistorySelection(other, channels)).toEqual(defaults);
    expect(readHistorySelection(key, channels)).toEqual(selected);
  });
  it("continues without storage when reads or writes are blocked", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Quota"); } });
    expect(readHistorySelection("history", channels)).toEqual(defaults);
    expect(() => saveHistorySelection("history", selected)).not.toThrow();
  });
  it("clears nested selections on context revocation and all scopes on logout", () => {
    const values = memoryStorage();
    const first = historyPreferencesKey(scope, "org-a", "device-a");
    const peer = historyPreferencesKey({ ...scope, sessionId: "session-b" }, "org-a", "device-a");
    saveHistorySelection(first, selected); saveHistorySelection(peer, selected);
    values[contextStorageKey(scope)] = "context"; values.unrelated = "keep";
    forgetContext(scope);
    expect(values[first]).toBeUndefined(); expect(values[contextStorageKey(scope)]).toBeUndefined();
    expect(readHistorySelection(peer, channels)).toEqual(selected);
    forgetContext(); expect(Object.keys(values)).toEqual(["unrelated"]);
  });
});
