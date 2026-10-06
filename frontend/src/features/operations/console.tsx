"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Brand } from "@/components/app-shell";
import { Button, Card, PageHeader, StatusBadge } from "@/components/ui";
import { useAuthSession } from "@/features/auth-session";
import { SecurityPage } from "@/features/account-security";
import { FactoryPage } from "@/features/factory";
import { useStaffQuery, QueryFeedback, type Schema } from "./shared";
import { PeoplePanel } from "./people";
import { OrganizationsPanel } from "./organizations";
import { DevicesPanel, OverviewPanel, AuditPanel, MonitoringPanel } from "./observability";

const sections = [
  ["overview", "Огляд", false],
  ["people", "Користувачі", true],
  ["organizations", "Організації", false],
  ["devices", "Обладнання", false],
  ["factory", "Виробництво", true],
  ["audit", "Журнал дій", true],
  ["monitoring", "Стан сервісів", true],
  ["security", "Моя безпека", false],
] as const;
const descriptions: Record<string, string> = {
  overview: "Поточний стан платформи та завдання, що потребують уваги.",
  people: "Облікові записи, ролі, безпека та доступ до платформи.",
  organizations: "Команди, об’єкти та права учасників.",
  devices: "Контролери, з’єднання та сервісне обслуговування.",
  factory: "Підготовка контролерів, захищених карток активації та постачання.",
  audit: "Хто, коли й що змінив. Окремо відображаються невдалі запити.",
  monitoring: "Доступність сервісів та використання ресурсів.",
  security: "Ваш пароль, застосунок автентифікації та відкриті сесії.",
};

export function StaffConsole() {
  const { session, logout } = useAuthSession();
  const router = useRouter();
  const params = useSearchParams();
  const profile = useStaffQuery<Schema["CurrentUserRead"]>("/api/v1/auth/me");
  const security = useStaffQuery<Schema["SecurityRead"]>("/api/v1/auth/security");
  const admin = profile.data?.platform_role === "superadmin";
  const requested = params.get("section") ?? "overview";
  const section =
    sections.find(([key, , restricted]) => key === requested && (!restricted || admin))?.[0] ?? "overview";
  const title = sections.find(([key]) => key === section)?.[1] ?? "Огляд";
  useEffect(() => {
    if (session.status === "anonymous") router.replace("/login");
  }, [router, session.status]);
  useEffect(() => {
    if (!profile.data) return;
    document.documentElement.dataset.theme = admin ? "admin" : "service";
  }, [admin, profile.data]);
  if (session.status !== "authenticated")
    return (
      <main className="connect-page">
        <p role="status">Перевіряємо вхід…</p>
        <Link href="/login">До входу</Link>
      </main>
    );
  if (!profile.data)
    return (
      <main className="connect-page">
        <QueryFeedback error={profile.error} loading={!profile.error} />
        <Button onClick={profile.refresh}>Повторити</Button>
      </main>
    );
  const ready = security.data?.mfa_enabled && security.data.current_session_verified;
  return (
    <div className="staff-shell">
      <a className="skip-link" href="#operations-content">
        Перейти до вмісту
      </a>
      <aside className="staff-sidebar">
        <Brand />
        <span className="staff-portal-name">{admin ? "Управління платформою" : "Сервісний кабінет"}</span>
        <nav aria-label="Службовий кабінет">
          {sections
            .filter(([, , restricted]) => !restricted || admin)
            .map(([key, label]) => (
              <Link
                key={key}
                href={`/operations?section=${key}` as Route}
                aria-current={section === key ? "page" : undefined}
              >
                <span className="staff-nav-mark" aria-hidden="true" />
                {label}
              </Link>
            ))}
        </nav>
        <div className="staff-sidebar-account">
          <strong>{profile.data.display_name}</strong>
          <span>{profile.data.email}</span>
          <StatusBadge tone="info">{admin ? "Головний адміністратор" : "Сервіс"}</StatusBadge>
          <Button onClick={() => void logout()}>Вийти</Button>
        </div>
      </aside>
      <div className="staff-workspace">
        <header className="staff-topbar">
          <span>KERUMO / {admin ? "Управління" : "Сервіс"}</span>
          <div className="ui-row">
            <Link href="/account/security">Моя безпека</Link>
            <Button size="small" onClick={() => void logout()}>
              Вийти
            </Button>
          </div>
        </header>
        <main id="operations-content" className="staff-content">
          <PageHeader
            eyebrow={admin ? "Головний адміністратор" : "Сервісний спеціаліст"}
            title={title}
            description={descriptions[section] ?? ""}
          />
          <QueryFeedback error={security.error} loading={!security.data && !security.error} />
          {!ready && section !== "security" ? (
            <Card
              title="Підготуйте захищений доступ"
              description="Для роботи зі службовою частиною потрібен двоетапний вхід."
            >
              <ol className="staff-steps">
                <li>Відкрийте налаштування безпеки.</li>
                <li>Додайте запис у застосунок і підтвердьте шестизначний код.</li>
                <li>Поверніться до кабінету. Якщо запис уже додано, увійдіть повторно з кодом.</li>
              </ol>
              <Link className="button button-primary" href="/account/security">
                Налаштувати захист
              </Link>
            </Card>
          ) : (
            <>
              {section === "overview" && <OverviewPanel admin={admin} />}
              {section === "people" && admin && <PeoplePanel />}
              {section === "organizations" && <OrganizationsPanel admin={admin} />}
              {section === "devices" && <DevicesPanel />}
              {section === "factory" && admin && <FactoryPage />}
              {section === "audit" && admin && <AuditPanel />}
              {section === "monitoring" && admin && <MonitoringPanel />}
              {section === "security" && <SecurityPage />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
