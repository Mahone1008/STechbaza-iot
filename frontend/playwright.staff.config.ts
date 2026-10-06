import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/staff", fullyParallel: false, workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:3001", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run start -- --port 3001", env: { NEXT_PUBLIC_PORTAL_MODE: "staff", NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8002" }, url: "http://127.0.0.1:3001", reuseExistingServer: false, timeout: 120_000 },
  outputDir: "test-results-staff",
});
