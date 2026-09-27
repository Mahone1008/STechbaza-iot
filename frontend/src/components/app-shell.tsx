"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/devices", label: "Пристрої", icon: "devices" as const },
  { href: "/alarms", label: "Аварії", icon: "alarm" as const, count: 2 },
  { href: "/ui-kit", label: "Компоненти", icon: "components" as const },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" aria-label="KERUMO">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="currentColor" d="M9 9h12v46H9z" />
        <path fill="currentColor" d="M27 10h27L34 31H21z" />
        <path fill="currentColor" d="M21 33h15l19 21H28z" />
      </svg>
      {!compact ? (
        <span className="brand-copy">
          <strong>KERUMO</strong>
          <span>Industrial IoT</span>
        </span>
      ) : null}
    </span>
  );
}

type IconName = "devices" | "alarm" | "components" | "more" | "chevron";

function Icon({ name, className = "nav-icon" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    devices: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h4M15 13h2M7 17h3M14 17h3" />
      </>
    ),
    alarm: (
      <>
        <path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
        <path d="M12 8v4M12 16h.01" />
      </>
    ),
    components: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Перейти до вмісту</a>

      <aside className="sidebar" aria-label="Основна навігація">
        <div className="sidebar-head"><Brand /></div>
        <div className="sidebar-context">
          <span className="context-label">Організація</span>
          <span className="context-value">АгроПром Північ<Icon name="chevron" className="nav-icon" /></span>
        </div>
        <nav className="sidebar-nav">
          {navigation.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link className={`nav-link${active ? " nav-link-active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {"count" in item ? <span className="nav-count">{item.count}</span> : null}
              </Link>
            );
          })}
          <span className="nav-link-disabled" aria-disabled="true"><Icon name="components" />Повідомлення</span>
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">ОП</span>
          <span className="user-copy"><strong>Олег Петренко</strong><span>Оператор</span></span>
          <button className="icon-button" type="button" aria-label="Меню користувача"><Icon name="more" /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <span className="topbar-brand"><Brand compact /></span>
          <div className="topbar-context"><span>АгроПром Північ</span><span aria-hidden="true">/</span><strong>Насосна станція №1</strong></div>
          <span className="prototype-note"><span className="prototype-dot" aria-hidden="true" />Каркас 9.2 · demo data</span>
        </header>
        <main className="workspace-content" id="main-content">{children}</main>
      </section>

      <nav className="mobile-nav" aria-label="Мобільна навігація">
        {([
          { href: "/devices/north-pump", label: "Панель", icon: "components" },
          { href: "/devices", label: "Пристрої", icon: "devices" },
          { href: "/alarms", label: "Аварії", icon: "alarm" },
          { href: "/ui-kit", label: "Ще", icon: "more" },
        ] as const).map((item) => {
          const active = item.href === "/devices" ? pathname === "/devices" : isActivePath(pathname, item.href);
          return (
            <Link href={item.href} key={item.href} data-active={active ? "true" : "false"}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export { Brand, Icon };
