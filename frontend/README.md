# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**Етап 9 завершено 4/4. Етап 10 завершено 4/4. Frontend roadmap: прийнято 8/24.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 закрито:** real FastAPI browser login із CSRF, HttpOnly refresh cookie,
  memory-only access token і auth error states.
- **10.2 закрито:** F5 recovery, proactive refresh, single-flight та
  coordination між same-origin вкладками.
- **10.3 закрито:** `/auth/me`, visible organizations, organization access,
  runtime permission registry, session-scoped cache, route guards і
  permission-aware controls.
- **10.4 закрито 27.09.2026:** real browser logout, server-side revoke,
  cross-tab cleanup, abort pending requests, logout failure/retry states,
  no session resurrection і фінальне Windows-приймання.
- **11.1 і 11.2 реалізовано:** реальні org/site/device API, context restore,
  pagination, bounded presence і unit/mocked/live регресії. Windows-приймання
  очікується; поточні докази CI — у досьє 11.2.
- Telemetry/modules/commands ще не підключені до real device pages;
  demo dashboard лише у `/ui-kit/device-demo`, alarms поки demo.

[Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).  
[Досьє V3.5 — Етап 10](../docs/dossier-v3.5-stage-10-browser-auth-session-rbac.md).  
[Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).  
[Досьє операції 10.2](../docs/stage-10-op2-session-recovery.md).  
[Досьє операції 10.3](../docs/stage-10-op3-permissions-and-guards.md).  
[Досьє операції 10.4](../docs/stage-10-op4-logout-and-failures.md).

## Стек

- Next.js 16.3.6, App Router;
- React / React DOM 19.2.8;
- TypeScript strict;
- TanStack Query 5.104.0;
- OpenAPI TypeScript 7.13.0;
- Vitest 5.0.2;
- Playwright 1.63.0, Chromium;
- CSS variables + звичайний CSS;
- ESLint flat config із core-web-vitals і TypeScript rules.

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийняті Етап 9 та
операції 10.1–10.3 на Node.js 24.21.0.

## Конфігурація

```powershell
Copy-Item .env.example .env.local
```

Public settings:

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_API_TIMEOUT_MS=10000
```

Не додавати secrets у `NEXT_PUBLIC_*`: ці values потрапляють до browser bundle.

## Перевірка 11.1 і 11.2

Зупинити Next.js через `Ctrl+C`, залишити Docker Desktop у Linux containers
mode і з кореня repository виконати:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage11-op1-op2.ps1 -Start
```

Gate запускає всі актуальні suites; credentials і volumes зберігаються.
Після PASS UI: <http://127.0.0.1:3000/login>.

[11.1 — поведінка й контекст](../docs/stage-11-op1-organizations-sites.md).

[11.2 — докази CI та ручне приймання](../docs/stage-11-op2-device-list.md).


## Маршрути

- `/login` — browser login, session recovery, logout notice і safe local `returnTo`;
- `/organizations` — paginated каталог організацій;
- `/organizations/{id}/sites` — об’єкти;
- `/organizations/{id}/sites/{siteId}/devices` — реальні пристрої;
- `/devices` — підтверджений поточний site context;
- `/devices/{UUID}` — справжня identity й availability;
- `/ui-kit/device-demo` — явно позначений demo dashboard;
- `/alarms` — protected demo incidents;
- `/ui-kit` — protected components і real `/health` panel.

Route permissions:

```text
/organizations → authenticated catalog
/organizations/{id}/sites → site.read
/organizations/{id}/sites/{siteId}/devices → device.read
/devices* → device.read
/alarms*  → alarm.read
/ui-kit*  → capability.read
```

Frontend guard покращує UX і не замінює backend authorization.

## OpenAPI

Backend snapshot: `src/lib/api/openapi.json`.  
Generated TypeScript: `src/lib/api/schema.d.ts`.

Regeneration після зміни backend contract:

```powershell
.\.venv\Scripts\python.exe ..\scripts\export_openapi.py
npm.cmd run api:generate
npm.cmd run api:verify
```

CI повторює generation і вимагає zero diff. Етап 10 завершено 4/4.
Поточна точка — спільне приймання 11.1/11.2; наступна реалізація — 11.3.
