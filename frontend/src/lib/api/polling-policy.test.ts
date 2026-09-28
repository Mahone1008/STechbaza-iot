import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { PollingBudget } from "./polling-policy";
const error = (kind: ApiError["kind"], retryAfterSeconds: number | null = null) => new ApiError("test", { kind, status: null, method: "GET", url: "/", retryAfterSeconds, requestId: null, details: null });
describe("bounded polling", () => {
  it("backs off consecutive failures and resets after success", () => {
    const b = new PollingBudget(); b.failure(error("server"), 30000, 0, 0); expect(b.interval(30000, 0)).toBe(30000);
    b.failure(error("server"), 30000, 30000, 0); expect(b.interval(30000, 30000)).toBe(60000);
    for (let i = 0; i < 20; i++) b.failure(error("network"), 30000, 0, 0);
    expect(b.interval(30000, 0)).toBe(300000); b.success(); expect(b.interval(30000, 0)).toBe(30000);
  });
  it("honors Retry-After beyond backoff cap, including manual and resumed requests", () => {
    const b = new PollingBudget(); b.failure(error("rate-limited", 600), 30000, 0, 0);
    expect(b.interval(30000, 0)).toBe(600000); expect(b.blocked(true, 599999)).toBe(true); expect(b.blocked(false, 599999)).toBe(true); expect(b.blocked(true, 600000)).toBe(false);
  });
  it("stops automatic requests for access, validation and contract errors", () => {
    for (const kind of ["unauthorized", "forbidden", "not-found", "conflict", "validation", "invalid-response", "aborted"] as const) {
      const b = new PollingBudget(); b.failure(error(kind), 30000, 0); expect(b.interval(30000)).toBe(false);
    }
  });
  it("manual mode has no interval; positive jitter does not shorten delays", () => {
    const b = new PollingBudget(); expect(b.interval(0)).toBe(false); b.failure(error("timeout"), 60000, 0, 1); expect(b.interval(60000, 0)).toBe(66000);
  });
});
