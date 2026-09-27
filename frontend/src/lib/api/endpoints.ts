import type { paths } from "./schema";
import { apiRequest } from "./client";

export type HealthResponse = paths["/health"]["get"]["responses"][200]["content"]["application/json"];

export function getBackendHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>({
    path: "/health",
    timeoutMs: 5_000,
    ...(signal ? { signal } : {}),
  });
}
