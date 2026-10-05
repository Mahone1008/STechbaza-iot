import { readFile } from "node:fs/promises";

const schemaUrl = new URL("../src/lib/api/openapi.json", import.meta.url);
const typesUrl = new URL("../src/lib/api/schema.d.ts", import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
const generatedTypes = await readFile(typesUrl, "utf8");
const expectedVersion = process.env.EXPECTED_BACKEND_VERSION ?? "0.49.0";

const requiredPaths = [
  "/health",
  "/api/v1/auth/browser/login",
  "/api/v1/auth/browser/refresh",
  "/api/v1/auth/browser/logout",
  "/api/v1/auth/me",
  "/api/v1/organizations",
  "/api/v1/devices/{device_id}/overview",
  "/api/v1/devices/{device_id}/telemetry/series",
  "/api/v1/devices/{device_id}/commands",
  "/api/v1/commands/{command_id}",
  "/api/v1/devices/{device_id}/schedules",
  "/api/v1/devices/{device_id}/equipment/replacement",
  "/api/v1/devices/{device_id}/equipment/commission",
  "/api/v1/connect/{controller_id}/access/{operation}",
  "/api/v1/bootstrap/{controller_id}/configuration",
];

if (schema?.info?.version !== expectedVersion) {
  throw new Error(`OpenAPI version ${schema?.info?.version ?? "missing"}; expected ${expectedVersion}.`);
}
for (const path of requiredPaths) {
  if (!schema.paths?.[path]) throw new Error(`Required OpenAPI path is missing: ${path}`);
}
if (!generatedTypes.includes("export interface paths") || !generatedTypes.includes('"/health"')) {
  throw new Error("Generated schema.d.ts does not contain the expected paths interface.");
}

console.log(`PASS: OpenAPI ${schema.info.version}; ${Object.keys(schema.paths).length} paths; generated TypeScript contract present.`);
