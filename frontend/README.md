# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**Етап 9 завершено 4/4. Етап 10: 2/4. Frontend roadmap: прийнято 6/24.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 закрито:** real FastAPI browser login із CSRF, HttpOnly refresh cookie,
  memory-only access token і auth error states.
- **10.2 закрито:** F5 recovery, proactive refresh, single-flight та
  coordination між same-origin вкладками.
- **10.3 реалізовано, CI PASS:** `/auth/me`, visible organizations,
  organization access, runtime permission registry, session-scoped cache,
  anonymous redirect, safe `returnTo`, permission-aware navigation і controls.
- **10.3 ще не закрито:** очікується локальне Windows-приймання користувачем.
- Devices, telemetry, alarms і command timeline поки використовують typed
  demo fixtures; live domain data починаються в Етапі 11.

[Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).  
[Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).  
[Досьє операції 10.2](../docs/stage-10-op2-session-recovery.md).  
[Досьє операції 10.3](../docs/stage-10-op3-permissions-and-guards.md).

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
операції 10.1–10.2 на Node.js 24.21.0.

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

## Перевірка операції 10.3

Зупинити попередній Next.js через `Ctrl+C`, залишити Docker Desktop у Linux
containers mode і з кореня repository виконати:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op3.ps1 -Start
```

Автоматично перевіряються:

```text
OpenAPI 0.38.0 / 47 paths
TypeScript strict і ESLint
Vitest — 22 passed
Next.js production build
Mocked Chromium — 19 passed
Real Chromium owner/viewer/session/guards — 6 passed
PostgreSQL/Mosquitto/FastAPI — Healthy
```

Очікуваний фінал:

```text
PASS: Stage 10.3 /auth/me profile, organization access, permission-aware UI, cache isolation and route guards.
```

Ручна перевірка:

1. Incognito `/devices` → `/login?returnTo=%2Fdevices` без workspace flash.
2. Owner бачить `DEMO: клієнт A`, свій email і `DEMO: owner · Власник`.
3. Viewer бачить `DEMO: viewer · Спостерігач`, але Start/Stop/frequency і
   settings disabled через відсутні permissions.

Access token не записується у localStorage/sessionStorage/URL. Query cache
ізольовано за `user_id + auth_session_id`; public `/health` cache не видаляється
разом із попередньою session.

## Маршрути

- `/login` — browser login, session recovery і safe local `returnTo`;
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

CI повторює generation і вимагає zero diff. Справжній logout/revoke,
coordinated cache cleanup та захист від session resurrection належать 10.4.
