import { describe, expect, it } from "vitest";

import { loginErrorPresentation, safeLoginReturnTo, validateLoginForm } from "@/features/login-model";
import { ApiError } from "@/lib/api";

function apiError(kind: ConstructorParameters<typeof ApiError>[1]["kind"], status: number | null, retryAfterSeconds: number | null = null) {
  return new ApiError("backend detail", {
    kind,
    status,
    method: "POST",
    url: "http://127.0.0.1:8001/api/v1/auth/browser/login",
    retryAfterSeconds,
    requestId: null,
    details: null,
  });
}

describe("login form model", () => {
  it("normalizes a valid email without changing the password", () => {
    const result = validateLoginForm({ email: "  Owner@Example.COM ", password: "secret" });
    expect(result.normalizedEmail).toBe("owner@example.com");
    expect(result.errors).toEqual({});
  });

  it("rejects malformed email, missing password and an oversized password", () => {
    expect(validateLoginForm({ email: "owner", password: "" }).errors).toEqual({
      email: expect.stringContaining("коректний email"),
      password: "Введіть пароль.",
    });
    expect(validateLoginForm({ email: "owner@example.com", password: "x".repeat(129) }).errors.password).toContain("128");
  });

  it("keeps invalid credentials generic", () => {
    const presentation = loginErrorPresentation(apiError("unauthorized", 401));
    expect(presentation.summary).toBe("Невірний email або пароль.");
    expect(presentation.clearPassword).toBe(true);
    expect(presentation.fieldErrors.password).toBeTruthy();
  });

  it("preserves Retry-After and distinguishes network failure", () => {
    const limited = loginErrorPresentation(apiError("rate-limited", 429, 17));
    expect(limited.retryAfterSeconds).toBe(17);
    expect(limited.summary).toContain("17");

    const network = loginErrorPresentation(apiError("network", null));
    expect(network.summary).toContain("Backend недоступний");
    expect(network.clearPassword).toBe(false);
  });

  it("accepts only local protected return paths", () => {
    expect(safeLoginReturnTo("/alarms")).toBe("/alarms");
    expect(safeLoginReturnTo("/devices/north-pump?tab=state")).toBe("/devices/north-pump?tab=state");
    expect(safeLoginReturnTo("//evil.example/path")).toBe("/devices");
    expect(safeLoginReturnTo("https://evil.example/path")).toBe("/devices");
    expect(safeLoginReturnTo("/login")).toBe("/devices");
    expect(safeLoginReturnTo("/admin")).toBe("/devices");
  });
});
