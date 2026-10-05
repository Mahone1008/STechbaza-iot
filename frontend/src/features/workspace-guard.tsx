"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { useAccessContext } from "@/features/access-context";
import { useAuthSession } from "@/features/auth-session";
import { organizationRoleLabel, type PermissionCode } from "@/lib/api";

function requiredPermission(pathname: string): PermissionCode {
  if (pathname === "/notifications" || /^\/organizations\/[^/]+\/notifications(?:\/|$)/u.test(pathname)) return "notification.read";
  if (pathname === "/alarms" || pathname.startsWith("/alarms/")) return "alarm.read";
  if (pathname === "/ui-kit" || pathname.startsWith("/ui-kit/")) return "capability.read";
  if (pathname === "/devices" || pathname.startsWith("/devices/")) return "device.read";
  if (pathname.startsWith("/organizations/") && pathname.endsWith("/devices")) return "device.read";
  if (pathname.startsWith("/organizations/")) return "site.read";
  return "organization.read";
}

function firstAllowedRoute(permissions: readonly string[]): Route | null {
  if (permissions.includes("device.read")) return "/devices";
  if (permissions.includes("alarm.read")) return "/alarms";
  if (permissions.includes("notification.read")) return "/notifications" as Route;
  return null;
}

function AccessGate({
  title,
  description,
  tone = "info",
  busy = false,
  children,
}: Readonly<{
  title: string;
  description: string;
  tone?: "info" | "warning" | "danger";
  busy?: boolean;
  children?: ReactNode;
}>) {
  return (
    <main className="access-gate">
      <section className="access-gate-card" role={tone === "danger" ? "alert" : "status"}>
        <div className="access-gate-brand" aria-label="KERUMO">KERUMO</div>
        <span className={`access-gate-mark access-gate-mark-${tone}${busy ? " access-gate-mark-busy" : ""}`} aria-hidden="true">
          {!busy && <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16h.01" /></svg>}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children ? <div className="access-gate-actions">{children}</div> : null}
      </section>
    </main>
  );
}

function LogoutFailureGate({
  message,
  retryAt,
  onRetry,
  onCancel,
}: Readonly<{
  message: string;
  retryAt: number | null;
  onRetry: () => void;
  onCancel: () => void;
}>) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (retryAt === null || retryAt <= Date.now()) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [retryAt]);

  const retrySeconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1_000));
  return (
    <AccessGate
      title="Не вдалося завершити сесію"
      description={`${message} Вихід ще не завершено. Повторіть спробу, коли відновиться з’єднання.`}
      tone="warning"
    >
      <Button variant="danger" disabled={retrySeconds > 0} onClick={onRetry}>
        {retrySeconds > 0 ? `Повторити через ${retrySeconds} с` : "Повторити вихід"}
      </Button>
      <Button variant="secondary" onClick={onCancel}>Повернутися до кабінету</Button>
    </AccessGate>
  );
}

function SessionRecoveryGate({ message, retryAt, onRetry }: Readonly<{
  message: string;
  retryAt: number | null;
  onRetry: () => void;
}>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAt === null || retryAt <= Date.now()) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [retryAt]);
  const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1_000));
  return (
    <AccessGate
      title="Не вдалося перевірити сесію"
      description={`${message} Відновіть з’єднання та повторіть перевірку, щоб продовжити роботу.`}
      tone="warning"
    >
      <Button variant="secondary" disabled={seconds > 0} onClick={onRetry}>
        {seconds > 0 ? `Повторити через ${seconds} с` : "Повторити перевірку"}
      </Button>
    </AccessGate>
  );
}

export function WorkspaceGuard({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, refreshSession, logout, cancelLogout } = useAuthSession();
  const { snapshot, retryAccess } = useAccessContext();
  const loginUrl = `/login?returnTo=${encodeURIComponent(pathname || "/devices")}` as Route;
  const loggedOutUrl = "/login?loggedOut=1" as Route;
  const redirectTargetRef = useRef<string | null>(null);
  const anonymousReason = session.status === "anonymous" ? session.reason : null;

  useEffect(() => {
    if (anonymousReason === null) {
      redirectTargetRef.current = null;
      return;
    }

    const target = anonymousReason === "logout" ? loggedOutUrl : loginUrl;
    if (redirectTargetRef.current === target) return;
    redirectTargetRef.current = target;
    router.replace(target);
  }, [anonymousReason, loggedOutUrl, loginUrl, router]);

  if (session.status === "logging-out") {
    return (
      <AccessGate
        title="Завершуємо сесію"
        busy
        description="Завершуємо вихід з облікового запису. Зачекайте кілька секунд."
      />
    );
  }

  if (session.status === "logout-failed") {
    return (
      <LogoutFailureGate
        message={session.message}
        retryAt={session.retryAt}
        onRetry={() => void logout()}
        onCancel={cancelLogout}
      />
    );
  }

  if (session.status === "restoring") {
    return <AccessGate title="Перевіряємо сесію" description="Перевіряємо ваш вхід, щоб відкрити кабінет." busy />;
  }

  if (session.status === "unavailable") {
    return (
      <SessionRecoveryGate
        message={session.message}
        retryAt={session.retryAt}
        onRetry={() => void refreshSession()}
      />
    );
  }

  if (session.status === "anonymous") {
    return <AccessGate title="Потрібен вхід" description="Переходимо до захищеної форми входу…" busy />;
  }

  if (snapshot.status === "idle" || snapshot.status === "resolving") {
    return <AccessGate title="Перевіряємо профіль і права" description="Завантажуємо ваші організації та доступне обладнання." busy />;
  }

  if (snapshot.status === "unavailable") {
    return (
      <AccessGate
        title="Не вдалося перевірити права"
        description={`${snapshot.message} Повторіть перевірку або оберіть іншу організацію.`}
        tone="warning"
      >
        <Link className="button button-secondary" href={"/account/security" as Route}>Безпека облікового запису</Link>
        <Button variant="secondary" onClick={retryAccess}>Повторити</Button>
        <Link className="button button-secondary" href={"/organizations" as Route}>Обрати організацію</Link>
        <Button onClick={() => void logout()}>Вийти</Button>
      </AccessGate>
    );
  }

  if (snapshot.status === "no-access") {
    return (
      <AccessGate
        title={snapshot.reason === "empty" ? "Додайте свій перший контролер" : "Немає доступної організації"}
        description={snapshot.reason === "empty" ? "Додайте контролер із комплекту. У майстрі активації ви створите об’єкт і виберете частотний перетворювач." : snapshot.message}
        tone={snapshot.reason === "empty" ? "info" : "warning"}
      >
        <Link className="button button-primary" href={"/connect" as Route}>Додати контролер</Link>
        <Button variant="secondary" onClick={retryAccess}>Оновити доступ</Button>
        <Link className="button button-secondary" href={"/organizations" as Route}>Обрати організацію</Link>
        <Button onClick={() => void logout()}>Вийти</Button>
      </AccessGate>
    );
  }

  if (snapshot.status === "directory") return pathname === "/organizations" ? children : null;
  if (snapshot.status !== "ready") return null;

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
        description={`Ваша роль «${role}» не дозволяє відкрити цей розділ в організації «${snapshot.activeOrganization.name}». Зверніться до адміністратора організації.`}
        tone="danger"
      >
        <Link className="button button-secondary" href={"/organizations" as Route}>Обрати організацію</Link>
        {fallback ? <Link className="button button-secondary" href={fallback}>Перейти до доступного розділу</Link> : null}
      </AccessGate>
    );
  }

  return children;
}
