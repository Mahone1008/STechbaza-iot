import { describe, expect, it } from "vitest";
import {
  ownerSetupFixture,
  helperSetupFixture,
  HELPER_ID,
  HELPER_TOKEN,
  SETUP_CONTROLLER_ID,
} from "../../../tests/fixtures/setup";
import { DEVICE_ID } from "../../../tests/browser/auth-fixtures";
import { parseCreatedHelper, parseOwnerSetup, parseSetupHelper, setupScope, setupSnapshotKey } from "./setup";

describe("bounded owner setup contract", () => {
  it("retains the reviewed proposal and all compare-and-swap revisions", () => {
    const data = parseOwnerSetup(ownerSetupFixture(), SETUP_CONTROLLER_ID, DEVICE_ID);
    expect(setupScope(data)).toEqual({
      expected_generation: 1,
      expected_credential_revision: 3,
      expected_configuration_revision: 2,
      expected_draft_revision: 0,
    });
    expect(setupSnapshotKey(data)).not.toBe(setupSnapshotKey({ ...data, draft_revision: 1 }));
    expect(setupSnapshotKey(data)).not.toBe(setupSnapshotKey({ ...data, credential_revision: 4 }));
  });
  it("rejects another controller, invalid revisions and acceptance without a verified target", () => {
    for (const change of [
      { device_id: HELPER_ID },
      { controller_id: HELPER_ID },
      { generation: 0 },
      { draft_revision: -1 },
      { configuration_hash: null },
      { needs_apply: true },
      { can_setup: false },
    ])
      expect(() => parseOwnerSetup(ownerSetupFixture(change), SETUP_CONTROLLER_ID, DEVICE_ID)).toThrow();
  });
  it("rejects malformed checks and equipment values instead of presenting a ready installation", () => {
    for (const change of [
      { checks: [{ code: "bad", title: "Invalid", status: "ready", detail: null }] },
      { equipment: { ...ownerSetupFixture().equipment, motor: { rated_frequency_hz: NaN } } },
      { progress: "started" },
    ])
      expect(() => parseOwnerSetup({ ...ownerSetupFixture(), ...change }, SETUP_CONTROLLER_ID, DEVICE_ID)).toThrow();
  });
});
describe("temporary helper contract", () => {
  it("allows narrow public profiles without requesting an authenticated catalog", () => {
    const data = parseSetupHelper(helperSetupFixture(), HELPER_ID);
    expect(data.profiles[0]?.tested_model).toBe("SU600A-5RG1-B");
    expect(() => parseSetupHelper(data, SETUP_CONTROLLER_ID)).toThrow();
  });
  it("validates a one-time-displayed proof and expiry before showing a link", () => {
    const value = {
      id: HELPER_ID,
      token: HELPER_TOKEN,
      created_at: "2026-10-13T12:00:00Z",
      expires_at: "2026-10-13T14:00:00Z",
      revoked_at: null,
      active: true,
    };
    expect(parseCreatedHelper(value).token).toBe(HELPER_TOKEN);
    expect(() => parseCreatedHelper({ ...value, token: "unbounded proof" })).toThrow();
    expect(() => parseCreatedHelper({ ...value, id: SETUP_CONTROLLER_ID })).toThrow();
    expect(() => parseCreatedHelper({ ...value, expires_at: "never" })).toThrow();
  });
});
