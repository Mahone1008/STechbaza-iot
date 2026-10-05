import { spawnSync } from "node:child_process";

// Extend this gate as older modules are touched; avoid unrelated formatting churn.
const files = [
  "src/features/account-gate.tsx",
  "src/features/account-security.tsx",
  "src/features/auth-session.tsx",
  "src/features/auth-session-runtime.ts",
  "src/features/connect.tsx",
  "src/features/device-overview.tsx",
  "src/features/factory.tsx",
  "src/features/register.tsx",
  "src/features/use-account-action.ts",
  "src/features/use-elapsed-seconds.ts",
  "src/lib/api/onboarding.ts",
];
const result = spawnSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
