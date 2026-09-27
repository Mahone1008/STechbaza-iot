import { describe, expect, it } from "vitest";

import {
  organizationRoleLabel,
  parseCurrentUserResponse,
  parseOrganizationAccessResponse,
  parseOrganizationListResponse,
} from "@/lib/api/access";
import { ApiError } from "@/lib/api/errors";

const userId = "0f4ac4a8-6a1d-4d4b-9f91-4c9d5d1a8b31";
const sessionId = "4df58667-7a29-47f8-b6d6-055e47717680";
const organizationId = "670b979d-9e60-5207-a5d2-5d86ee70c71c";

function currentUser() {
  return {
    id: userId,
    email: "owner@example.com",
    display_name: "Owner",
    platform_role: "user",
    is_active: true,
    auth_session_id: sessionId,
    auth_session_expires_at: "2026-10-27T12:00:00Z",
    memberships: [{ organization_id: organizationId, role: "owner" }],
  };
}

describe("access API runtime contracts", () => {
  it("parses the current user and active membership", () => {
    const parsed = parseCurrentUserResponse(currentUser());
    expect(parsed.email).toBe("owner@example.com");
    expect(parsed.memberships).toEqual([{ organization_id: organizationId, role: "owner" }]);
  });

  it("rejects malformed session identity", () => {
    expect(() => parseCurrentUserResponse({ ...currentUser(), auth_session_id: "not-a-uuid" })).toThrow(ApiError);
  });

  it("parses visible organizations and exact permissions", () => {
    const organizations = parseOrganizationListResponse([{
      id: organizationId,
      name: "DEMO: клієнт A",
      slug: "techbaza-demo-a",
      is_active: true,
      created_at: "2026-09-27T12:00:00Z",
      updated_at: "2026-09-27T12:00:00Z",
    }]);
    expect(organizations[0]?.name).toBe("DEMO: клієнт A");

    const access = parseOrganizationAccessResponse({
      organization_id: organizationId,
      platform_role: "user",
      organization_role: "viewer",
      permissions: ["organization.read", "device.read", "telemetry.read", "device.read"],
    }, organizationId);
    expect(access.permissions).toEqual(["organization.read", "device.read", "telemetry.read"]);
  });

  it("rejects unknown permissions and maps role labels", () => {
    expect(() => parseOrganizationAccessResponse({
      organization_id: organizationId,
      platform_role: "user",
      organization_role: "owner",
      permissions: ["device.destroy"],
    }, organizationId)).toThrow(ApiError);
    expect(organizationRoleLabel("operator")).toBe("Оператор");
    expect(organizationRoleLabel(null, "superadmin")).toBe("Суперадміністратор");
  });
});
