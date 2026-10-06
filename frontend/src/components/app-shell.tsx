"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useAccessContext, type ReadyAccessSnapshot, type DirectoryAccessSnapshot } from "@/features/access-context";
import { InventoryBreadcrumbs, sitesHref } from "@/features/inventory";
import { useAuthSession, type AuthSessionSnapshot } from "@/features/auth-session";
import { organizationRoleLabel, type PermissionCode } from "@/lib/api";

type NavigationItem = Readonly<{
  href: Route;
  label: string;
  icon: "devices" | "alarm" | "components";
  permission: PermissionCode;
}>;

type MobileNavigationItem = Readonly<{
  href: Route;
  label: string;
  icon: "devices" | "alarm" | "components" | "more";
  permission: PermissionCode;
}>;

const navigation: readonly NavigationItem[] = [
  { href: "/organizations" as Route, label: "Організації", icon: "components", permission: "organization.read" },
  { href: "/devices", label: "Пристрої", icon: "devices", permission: "device.read" },
  { href: "/alarms", label: "Аварії", icon: "alarm", permission: "alarm.read" },
  { href: "/notifications" as Route, label: "Повідомлення", icon: "components", permission: "notification.read" },
];

const mobileNavigationItems: readonly MobileNavigationItem[] = [
  { href: "/organizations" as Route, label: "Організації", icon: "components", permission: "organization.read" },
  { href: "/devices", label: "Пристрої", icon: "devices", permission: "device.read" },
  { href: "/alarms", label: "Аварії", icon: "alarm", permission: "alarm.read" },
  { href: "/notifications" as Route, label: "Повідомлення", icon: "components", permission: "notification.read" },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" role="img" aria-label="KERUMO">
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

type IconName = "devices" | "alarm" | "components" | "more" | "chevron" | "logout" | "security";

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
    security: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
        <path d="m14 8 4 4-4 4M9 12h9" />
      </>
    ),
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/notifications") return pathname === href || /^\/organizations\/[^/]+\/notifications(?:\/|$)/u.test(pathname);
  if (href === "/organizations" && pathname.includes("/notifications")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFor(value: string): string {
  const localPart = value.split("@")[0] ?? value;
  const chunks = localPart.split(/[._\-\s]+/u).filter(Boolean);
  return chunks.slice(0, 2).map((chunk) => chunk[0]?.toUpperCase() ?? "").join("") || "К";
}

function routeLabel(pathname: string): string {
  if (pathname === "/notifications" || pathname.includes("/notifications")) return "Повідомлення";
  if (pathname === "/organizations") return "Організації";
  if (pathname.startsWith("/organizations/")) return pathname.endsWith("/devices") ? "Пристрої" : "Об’єкти";
  if (pathname === "/devices") return "Пристрої";
  if (pathname.startsWith("/devices/")) return "Панель пристрою";
  if (pathname.startsWith("/alarms")) return "Аварії та інциденти";
  if (pathname.startsWith("/ui-kit")) return "Базові компоненти";
  return "Кабінет";
}

function sessionPresentation(
  session: AuthSessionSnapshot,
  ready: ReadyAccessSnapshot | DirectoryAccessSnapshot,
): Readonly<{
  userName: string;
  userStatus: string;
  connectionWarning: boolean;
}> {
  const role = organizationRoleLabel(
    ready.status === "ready" ? ready.access.organization_role : null,
    ready.profile.platform_role,
  );

  return {
    userName: ready.profile.login_name ?? ready.profile.email,
    userStatus: role,
    connectionWarning: session.status === "authenticated" && session.refreshState === "degraded",
  };
}

type SessionPresentation = ReturnType<typeof sessionPresentation>;

function UserMenu({
  presentation,
  organizationName,
  compact = false,
}: Readonly<{
  presentation: SessionPresentation;
  organizationName: string;
  compact?: boolean;
}>) {
  const { logout } = useAuthSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    actionRef.current?.focus();

    const closeFromPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  return (
    <div className={`user-menu${compact ? " user-menu-compact" : ""}`} ref={rootRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button
        className={compact ? "topbar-account-button" : "icon-button"}
        type="button"
        aria-label="Відкрити меню користувача"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}
        ref={triggerRef}
      >
        {compact ? (
          <span className="avatar avatar-compact" aria-hidden="true">{initialsFor(presentation.userName)}</span>
        ) : (
          <Icon name="more" />
        )}
      </button>

      {open ? (
        <div className="user-menu-popover" id={menuId} role="menu" aria-label="Меню користувача"
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : -1;
            if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
          }}>
          <div className="user-menu-profile">
            <strong>{presentation.userName}</strong>
            <span>{presentation.userStatus}</span>
            <small>{organizationName}</small>
          </div>
          <div className="user-menu-separator" />
          <Link className="user-menu-action" role="menuitem" href={"/account/security" as Route} onClick={() => setOpen(false)}><Icon name="security" /><span>Безпека облікового запису</span></Link>
          {process.env.NEXT_PUBLIC_PORTAL_MODE === "staff" ? (
            <Link className="user-menu-action" role="menuitem" href={"/operations" as Route} onClick={() => setOpen(false)}><Icon name="components" /><span>Службовий кабінет</span></Link>
          ) : (
            <Link className="user-menu-action" role="menuitem" href={"/connect" as Route} onClick={() => setOpen(false)}><Icon name="devices" /><span>Додати контролер</span></Link>
          )}
          <button
            className="user-menu-action user-menu-action-danger"
            type="button"
            role="menuitem"
            ref={actionRef}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <Icon name="logout" />
            <span><strong>Вийти з акаунта</strong><small>Завершити поточний сеанс</small></span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { session } = useAuthSession();
  const { snapshot, hasPermission } = useAccessContext();

  if (snapshot.status !== "ready" && snapshot.status !== "directory") return null;

  const organizationName = snapshot.status === "ready" ? snapshot.activeOrganization.name : "Оберіть організацію";
  const visible = (item: NavigationItem | MobileNavigationItem) => String(item.href) === "/organizations" || hasPermission(item.permission);

  const presentation = sessionPresentation(session, snapshot);
  const visibleNavigation = navigation.filter(visible);
  const mobileNavigation = mobileNavigationItems.filter(visible);
  const mobileStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(1, mobileNavigation.length)}, minmax(0, 1fr))`,
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Перейти до вмісту</a>

      <aside className="sidebar" aria-label="Основна навігація">
        <div className="sidebar-head"><Brand /></div>
        <div className="sidebar-context">
          <span className="context-label">Організація</span>
          <Link href={"/organizations" as Route} className="context-value">{organizationName}<Icon name="chevron" className="nav-icon" /></Link>
          {snapshot.status === "ready" ? <Link className="context-label" href={sitesHref(snapshot.activeOrganization.id)}>Змінити об’єкт</Link> : null}
        </div>
        <nav className="sidebar-nav">
          {visibleNavigation.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link className={`nav-link${active ? " nav-link-active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">{initialsFor(presentation.userName)}</span>
          <span className="user-copy" title={presentation.userName}><strong>{presentation.userName}</strong><span>{presentation.userStatus}</span></span>
          <UserMenu presentation={presentation} organizationName={organizationName} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <span className="topbar-brand"><Brand compact /></span>
          <div className="topbar-context"><span>{organizationName}</span><span aria-hidden="true">/</span><strong>{routeLabel(pathname)}</strong></div>
          <div className="topbar-actions">
            {process.env.NEXT_PUBLIC_PORTAL_MODE === "staff" && <Link className="button button-small button-secondary" href={"/operations" as Route}>До кабінету</Link>}
            {presentation.connectionWarning && (
              <span className="connection-notice" role="status">З’єднання нестабільне</span>
            )}
            <div className="topbar-user-menu">
              <UserMenu compact presentation={presentation} organizationName={organizationName} />
            </div>
          </div>
        </header>
        <main className="workspace-content" id="main-content" tabIndex={-1}>
          <InventoryBreadcrumbs />
          {pathname === "/devices" && session.status === "authenticated" && session.source === "login" && !session.email?.startsWith("ku-") && (
            <div className="notice notice-info password-guidance">
              <span>Якщо пароль вам передали разом із доступом, замініть його на власний у налаштуваннях безпеки.</span>
              <Link className="button button-secondary" href="/account/security">Змінити пароль</Link>
            </div>
          )}
          {children}
        </main>
      </section>

      <nav className="mobile-nav" aria-label="Мобільна навігація" style={mobileStyle}>
        {mobileNavigation.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link href={item.href} key={item.href} data-active={active ? "true" : "false"} aria-current={active ? "page" : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export { Brand };
