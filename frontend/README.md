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
- Devices, telemetry, alarms і command timeline поки використовують typed
  demo fixtures; live domain data починаються в Етапі 11.

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

## Перевірка операції 10.4

Зупинити попередній Next.js через `Ctrl+C`, залишити Docker Desktop у Linux
containers mode і з кореня repository виконати:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op4.ps1 -Start
```

Автоматично перевіряються:

```text
OpenAPI 0.38.0 / 47 paths
TypeScript strict і ESLint
Vitest — 23 passed
Next.js production build
Mocked Chromium — 23 passed
Real Chromium auth/session/permissions/logout — 8 passed
PostgreSQL/Mosquitto/FastAPI — Healthy
```

Очікуваний фінал:

```text
PASS: Stage 10.4 server-side logout, cross-tab revoke, private cache cleanup and no session resurrection.
```

Ручна перевірка:

1. Увійти як owner і відкрити `/devices` у другій вкладці.
2. У першій вкладці відкрити user menu `…` і натиснути `Вийти з акаунта`.
3. Обидві вкладки мають перейти на `/login?loggedOut=1`.
4. В обох вкладках має бути `Сесію завершено`.
5. F5 не повинен відновити session.
6. Новий direct `/devices` не повинен показувати workspace або tenant data.

Logout marker `kerumo.auth.logout.v1` містить лише короткоживучі
`issuedAt/expiresAt/nonce`, без access/refresh token, email або tenant ids.
Access token залишається memory-only; backend revoke робить старий JWT
недійсним до його природного expiry.

## Маршрути

- `/login` — browser login, session recovery, logout notice і safe local `returnTo`;
- `/devices` — protected demo fleet до Етапу 11;
- `/devices/north-pump` — protected modular dashboard;
- `/alarms` — protected demo incidents;
- `/ui-kit` — protected components і real `/health` panel.

Route permissions:

```text
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
Наступна операція — 11.1: реальні організації, об’єкти, breadcrumbs і
tenant context restore.
