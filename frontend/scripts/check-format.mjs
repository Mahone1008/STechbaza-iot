import { spawnSync } from "node:child_process";

// Extend this gate as older modules are touched; avoid unrelated formatting churn.
const files = [
  "src/components/controller-qr.tsx",
  "src/components/controller-qr-code.tsx",
  "src/components/text-field.tsx",
  "src/features/login.tsx",
  "src/features/login-cooldown.ts",
  "src/features/schedule-panel.tsx",
  "src/features/login-model.ts",
  "src/features/controller-lifecycle.tsx",
  "src/features/equipment-actions.tsx",
  "src/features/factory-controller-actions.tsx",
  "src/features/equipment-passport.tsx",
  "src/features/account-gate.tsx",
  "src/features/account-security.tsx",
  "src/features/auth-session.tsx",
  "src/features/auth-session-runtime.ts",
  "src/features/connect.tsx",
  "src/features/device-overview.tsx",
  "src/features/factory.tsx",
  "src/features/recover.tsx",
  "src/features/controller-activation.tsx",
  "src/features/permanent-access.tsx",
  "src/features/use-account-action.ts",
  "src/features/use-elapsed-seconds.ts",
  "src/lib/api/onboarding.ts",
];
const result = spawnSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
