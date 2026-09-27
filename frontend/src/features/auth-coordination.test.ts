import { describe, expect, it } from "vitest";

import {
  isSnapshotUsable,
  parseAuthChannelMessage,
  refreshDelayMs,
  refreshRetryDelayMs,
  type AuthSessionSnapshotMessage,
} from "@/features/auth-coordination";

function snapshot(overrides: Partial<AuthSessionSnapshotMessage> = {}): AuthSessionSnapshotMessage {
  const issuedAt = 1_000_000;
  return {
    version: 1,
    type: "session-snapshot",
    sourceTab: "tab-a",
    targetTab: null,
    issuedAt,
    sessionOrigin: "refresh",
    email: null,
    accessToken: "a".repeat(64),
    accessExpiresAt: issuedAt + 900_000,
    sessionExpiresAt: issuedAt + 2_592_000_000,
    ...overrides,
  };
}

describe("auth cross-tab coordination", () => {
  it("accepts a valid memory-only snapshot and rejects malformed messages", () => {
    const value = snapshot();
    expect(parseAuthChannelMessage(value, value.issuedAt)).toEqual(value);
    expect(parseAuthChannelMessage({ ...value, accessToken: "short" }, value.issuedAt)).toBeNull();
    expect(parseAuthChannelMessage({ ...value, accessExpiresAt: value.issuedAt }, value.issuedAt)).toBeNull();
    expect(parseAuthChannelMessage({ version: 2, type: "session-request" })).toBeNull();
  });

  it("does not use expired peer access tokens", () => {
    const value = snapshot({ accessExpiresAt: 1_010_000 });
    expect(isSnapshotUsable(value, 1_000_000, 5_000)).toBe(true);
    expect(isSnapshotUsable(value, 1_006_000, 5_000)).toBe(false);
  });

  it("refreshes early without creating a tight timer loop", () => {
    expect(refreshDelayMs(1_900_000, 1_000_000)).toBe(840_000);
    expect(refreshDelayMs(1_020_000, 1_000_000)).toBe(16_000);
    expect(refreshDelayMs(1_000_100, 1_000_000)).toBe(1_000);
  });

  it("uses Retry-After before exponential fallback", () => {
    expect(refreshRetryDelayMs(0, 12)).toBe(12_000);
    expect(refreshRetryDelayMs(0, null)).toBe(1_000);
    expect(refreshRetryDelayMs(2, null)).toBe(15_000);
    expect(refreshRetryDelayMs(99, null)).toBe(60_000);
  });
});
