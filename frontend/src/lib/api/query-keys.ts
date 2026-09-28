export type SessionScope = Readonly<{
  userId: string;
  sessionId: string;
}>;

function sessionRoot(scope: SessionScope) {
  return ["kerumo", "session", scope.userId, scope.sessionId] as const;
}

export const apiQueryKeys = {
  publicRoot: () => ["kerumo", "public"] as const,
  health: () => ["kerumo", "public", "health"] as const,
  allSessionsRoot: () => ["kerumo", "session"] as const,
  sessionRoot,
  inventory: (scope: SessionScope, organizationId: string | null, siteId: string | null, resource: string, page: number = 0) =>
    [...sessionRoot(scope), "inventory", organizationId, siteId, resource, { page, limit: 20 }] as const,
  currentUser: (scope: SessionScope) => [...sessionRoot(scope), "auth", "me"] as const,
  organizations: (scope: SessionScope) => [...sessionRoot(scope), "organizations"] as const,
  organizationAccess: (scope: SessionScope, organizationId: string) =>
    [...sessionRoot(scope), "organizations", organizationId, "access"] as const,
  sites: (scope: SessionScope, organizationId: string, page: number) =>
    [...sessionRoot(scope), "organizations", organizationId, "sites", { page }] as const,
  devices: (scope: SessionScope, siteId: string, page: number) =>
    [...sessionRoot(scope), "sites", siteId, "devices", { page }] as const,
  deviceOverview: (scope: SessionScope, deviceId: string) =>
    [...sessionRoot(scope), "devices", deviceId, "overview"] as const,
  telemetrySeries: (
    scope: SessionScope,
    deviceId: string,
    metric: string,
    start: string,
    end: string,
    bucketSeconds: number,
  ) =>
    [
      ...sessionRoot(scope),
      "devices",
      deviceId,
      "telemetry",
      "series",
      { metric, start, end, bucketSeconds },
    ] as const,
  command: (scope: SessionScope, commandId: string) =>
    [...sessionRoot(scope), "commands", commandId] as const,
  deviceCommands: (scope: SessionScope, deviceId: string, page: number) =>
    [...sessionRoot(scope), "devices", deviceId, "commands", { page }] as const,
  deviceAlarms: (scope: SessionScope, deviceId: string, page: number) =>
    [...sessionRoot(scope), "devices", deviceId, "alarms", { page }] as const,
  notifications: (scope: SessionScope, organizationId: string, page: number) =>
    [...sessionRoot(scope), "organizations", organizationId, "notifications", { page }] as const,
};
