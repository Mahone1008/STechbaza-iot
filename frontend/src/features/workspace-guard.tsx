"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { useAccessContext } from "@/features/access-context";
import { useAuthSession } from "@/features/auth-session";
import { organizationRoleLabel, type PermissionCode } from "@/lib/api";

function requiredPermission(pathname: string): PermissionCode {
  if (pathname === "/alarms" || pathname.startsWith("/alarms/")) return "alarm.read";
  if (pathname === "/ui-kit" || pathname.startsWith("/ui-kit/")) return "capability.read";
  if (pathname === "/devices" || pathname.startsWith("/devices/")) return "device.read";
  return "organization.read";
}

function firstAllowedRoute(permissions: readonly string[]): Route | null {
  if (permissions.includes("device.read")) return "/devices";
  if (permissions.includes("alarm.read")) return "/alarms";
  if (permissions.includes("capability.read")) return "/ui-kit";
  return null;
}

function AccessGate({
  title,
  description,
  tone = "info",
  children,
}: Readonly<{
  title: string;
  description: string;
  tone?: "info" | "warning" | "danger";
  children?: ReactNode;
}>) {
  return (
    <main className="access-gate">
      <section className="access-gate-card" role={tone === "danger" ? "alert" : "status"}>
        <div className="access-gate-brand" aria-label="KERUMO">KERUMO</div>
        <span className={`access-gate-mark access-gate-mark-${tone}`} aria-hidden="true" />
        <h1>{title}</h1>
        <p>{description}</p>
        {children ? <div className="access-gate-actions">{children}</div> : null}
      </section>
    </main>
  );
}

export function WorkspaceGuard({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, refreshSession } = useAuthSession();
  const { snapshot, retryAccess } = useAccessContext();
  const loginUrl = `/login?returnTo=${encodeURIComponent(pathname || "/devices")}` as Route;

  useEffect(() => {
    if (session.status === "anonymous") router.replace(loginUrl);
  }, [loginUrl, router, session.status]);

  if (session.status === "restoring") {
    return <AccessGate title="Перевіряємо сесію" description="Безпечна HttpOnly session перевіряється через backend." />;
  }

  if (session.status === "unavailable") {
    return (
      <AccessGate
        title="Не вдалося перевірити сесію"
        description={`${session.message} Дані кабінету не показуються, доки session не підтверджена.`}
        tone="warning"
      >
        <Button variant="secondary" onClick={() => void refreshSession()}>Повторити перевірку</Button>
      </AccessGate>
    );
  }

  if (session.status === "anonymous") {
    return <AccessGate title="Потрібен вхід" description="Переходимо до захищеної форми входу…" />;
  }

  if (snapshot.status === "idle" || snapshot.status === "resolving") {
    return <AccessGate title="Перевіряємо профіль і права" description="Завантажуємо /auth/me, доступні організації та актуальні permissions." />;
  }

  if (snapshot.status === "unavailable") {
    return (
      <AccessGate
        title="Не вдалося перевірити права"
        description={`${snapshot.message} Кабінет не показує tenant data без підтвердженого access context.`}
        tone="warning"
      >
        <Button variant="secondary" onClick={retryAccess}>Повторити</Button>
      </AccessGate>
    );
  }

  if (snapshot.status === "no-access") {
    return (
      <AccessGate title="Немає доступної організації" description={snapshot.message} tone="danger">
        <Button variant="secondary" onClick={retryAccess}>Оновити доступ</Button>
      </AccessGate>
    );
  }

  const permission = requiredPermission(pathname);
  const permissions = snapshot.access.permissions as readonly string[];
  if (!permissions.includes(permission)) {
    const fallback = firstAllowedRoute(permissions);
    const role = organizationRoleLabel(
      snapshot.access.organization_role,
      snapshot.profile.platform_role,
    );
    return (
      <AccessGate
        title="Недостатньо прав"
        description={`${role} не має permission ${permission} в організації «${snapshot.activeOrganization.name}». Backend залишається остаточним authorization guard.`}
        tone="danger"
      >
        {fallback ? <Link className="button button-secondary" href={fallback}>Перейти до доступного розділу</Link> : null}
      </AccessGate>
    );
  }

  return children;
}
