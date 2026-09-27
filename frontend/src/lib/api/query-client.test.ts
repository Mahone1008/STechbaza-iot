import { describe, expect, it } from "vitest";

import {
  apiQueryKeys,
  clearAllSessionCaches,
  clearSessionCache,
  createKerumoQueryClient,
  type SessionScope,
} from "@/lib/api";

const first: SessionScope = { userId: "user-a", sessionId: "session-a" };
const second: SessionScope = { userId: "user-b", sessionId: "session-b" };

describe("session cache isolation", () => {
  it("clears one session without deleting another or public data", async () => {
    const client = createKerumoQueryClient();
    client.setQueryData(apiQueryKeys.health(), { status: "ok" });
    client.setQueryData(apiQueryKeys.currentUser(first), { email: "a@example.com" });
    client.setQueryData(apiQueryKeys.currentUser(second), { email: "b@example.com" });

    await clearSessionCache(client, first);

    expect(client.getQueryData(apiQueryKeys.currentUser(first))).toBeUndefined();
    expect(client.getQueryData(apiQueryKeys.currentUser(second))).toEqual({ email: "b@example.com" });
    expect(client.getQueryData(apiQueryKeys.health())).toEqual({ status: "ok" });
  });

  it("clears every authenticated scope but preserves the public cache", async () => {
    const client = createKerumoQueryClient();
    client.setQueryData(apiQueryKeys.health(), { status: "ok" });
    client.setQueryData(apiQueryKeys.organizationAccess(first, "org-a"), { role: "owner" });
    client.setQueryData(apiQueryKeys.organizationAccess(second, "org-b"), { role: "viewer" });

    await clearAllSessionCaches(client);

    expect(client.getQueryData(apiQueryKeys.organizationAccess(first, "org-a"))).toBeUndefined();
    expect(client.getQueryData(apiQueryKeys.organizationAccess(second, "org-b"))).toBeUndefined();
    expect(client.getQueryData(apiQueryKeys.health())).toEqual({ status: "ok" });
  });
});
