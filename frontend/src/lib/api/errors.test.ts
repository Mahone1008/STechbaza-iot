import { describe, expect, it } from "vitest";

import { ApiError, apiErrorDisplayMessage, apiErrorKindForStatus, parseRetryAfter, problemMessage } from "@/lib/api/errors";

describe("API error contract", () => {
  it("maps security and conflict statuses without reading localized backend text", () => {
    expect(apiErrorKindForStatus(401)).toBe("unauthorized");
    expect(apiErrorKindForStatus(403)).toBe("forbidden");
    expect(apiErrorKindForStatus(409)).toBe("conflict");
    expect(apiErrorKindForStatus(422)).toBe("validation");
    expect(apiErrorKindForStatus(429)).toBe("rate-limited");
    expect(apiErrorKindForStatus(503)).toBe("server");
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("15", 0)).toBe(15);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:20 GMT", 10_000)).toBe(10);
    expect(parseRetryAfter("not-a-date", 0)).toBeNull();
  });

  it("extracts validation messages and keeps safe fallback copy", () => {
    expect(problemMessage({ detail: [{ msg: "Email некоректний" }, { msg: "Пароль закороткий" }] }, 422)).toBe(
      "Email некоректний Пароль закороткий",
    );
    expect(problemMessage({}, 403)).toBe("Недостатньо прав для цієї дії.");
  });

  it("shows network and timeout errors as failures, not empty data", () => {
    const network = new ApiError("fetch failed", {
      kind: "network",
      status: null,
      method: "GET",
      url: "http://127.0.0.1:8001/health",
      retryAfterSeconds: null,
      requestId: null,
      details: null,
    });
    const timeout = new ApiError("timeout", {
      kind: "timeout",
      status: null,
      method: "GET",
      url: "http://127.0.0.1:8001/health",
      retryAfterSeconds: null,
      requestId: null,
      details: null,
    });

    expect(apiErrorDisplayMessage(network)).toContain("Backend недоступний");
    expect(apiErrorDisplayMessage(timeout)).toContain("не відповів");
  });
});
