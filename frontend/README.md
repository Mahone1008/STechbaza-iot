# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**Етап 9 завершено 4/4. Етап 10: 2/4. Frontend roadmap: прийнято 6/24.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 закрито:** реальний FastAPI browser login із CSRF, HttpOnly refresh
  cookie, memory-only access token і auth error states.
- **10.2 закрито 27.09.2026:** F5 recovery, proactive refresh, in-tab
  single-flight, Web Locks/localStorage lease fallback і BroadcastChannel
  coordination між same-origin вкладками.
- Локальне Windows-приймання підтвердило automatic `/login` → `/devices`
  recovery без повторного password і status `Сесія відновлена · demo data`.
- Devices, telemetry, alarms і commands поки використовують typed demo
  fixtures; permissions і route guards реалізуються в 10.3.

[Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).  
[Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).  
[Досьє операції 10.2](../docs/stage-10-op2-session-recovery.md).

**Наступна операція — 10.3: `/auth/me`, реальні permissions,
organization access, cache isolation і route guards.**

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

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийняті Етап 9,
операції 10.1 і 10.2 на Node.js 24.21.0.

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

## Прийнята перевірка операції 10.2

Зупинити попередній Next.js через `Ctrl+C`, потім із кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op2.ps1 -Start
```

Підтверджено 27.09.2026:

```text
OpenAPI 0.38.0 / 47 paths — PASS
TypeScript strict — PASS
ESLint — PASS
Vitest — 15 passed
Production build — PASS
Mocked Chromium — 13 passed
Real Chromium — 4 passed
Docker PostgreSQL/Mosquitto/backend — Healthy
PASS: Stage 10.2 HttpOnly session recovery, proactive refresh, single-flight and cross-tab coordination.
```

Ручне Windows-приймання підтвердило:

1. відкриття `/login` із чинною HttpOnly session;
2. стан перевірки/відновлення без показу secret;
3. автоматичний redirect на `/devices` без email/password;
4. `Сесія відновлена · demo data` у topbar;
5. повторний password не запитується.

Access token не записується у localStorage/sessionStorage/URL. localStorage
fallback містить тільки короткоживу lock lease metadata без token.

## Повна перевірка операції 10.1

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op1.ps1 -Start
```

## Маршрути

- `/login` — справжній browser login і automatic session recovery;
- `/devices` — demo fleet до Етапу 11;
- `/devices/north-pump` — demo modular dashboard;
- `/alarms` — demo incidents;
- `/ui-kit` — components і real `/health` API Contract panel.

## OpenAPI

Backend snapshot: `src/lib/api/openapi.json`.  
Generated TypeScript: `src/lib/api/schema.d.ts`.

Regeneration після зміни backend contract:

```powershell
.\.venv\Scripts\python.exe ..\scripts\export_openapi.py
npm.cmd run api:generate
npm.cmd run api:verify
```

CI повторює generation і вимагає zero diff. `/auth/me`, permissions,
organization access, cache isolation і route guards належать операції 10.3;
logout і coordinated revoke — операції 10.4.