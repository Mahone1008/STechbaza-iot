import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { WorkspaceGuard } from "@/features/workspace-guard";

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkspaceGuard>
      <AppShell>{children}</AppShell>
    </WorkspaceGuard>
  );
}
