# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**Етап 9 завершено 4/4. Етап 10: 1/4. Frontend roadmap: прийнято 5/24.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 закрито 27.09.2026:** `/login` виконує справжній FastAPI browser
  login із CSRF, HttpOnly refresh cookie, memory-only access token, validation,
  401/403/422/429/network states, mocked і real Chromium tests.
- Локальне Windows-приймання підтвердило реальний redirect на `/devices`,
  email у sidebar і статус `Сесія підтверджена · demo data`.
- Devices, telemetry, alarms і commands поки використовують typed demo
  fixtures; route guards починаються в 10.3.

[Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).  
[Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).

**Наступна операція — 10.2: refresh coordinator і відновлення browser session після F5.**

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

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийнято на
Node.js 24.21.0.

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

## Прийнята перевірка операції 10.1

З кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op1.ps1 -Start
```

Підтверджено:

- OpenAPI 0.38.0 / 47 paths;
- TypeScript strict і ESLint;
- Vitest — 11 passed;
- production build;
- mocked Chromium — 9 passed;
- real Chromium login — 2 passed;
- Docker demo backend/PostgreSQL/Mosquitto — Healthy;
- фінальний Stage 10.1 PASS;
- ручний login `owner@techbaza-demo.example.com` → `/devices`.

Demo password читається лише локально з `.env.demo` і не друкується. Access
token не зберігається у localStorage або sessionStorage. Відновлення після F5
реалізується в 10.2.

## Повна перевірка фундаменту Етапу 9

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op4.ps1 -Start
```

## Маршрути

- `/login` — справжній browser login;
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

CI повторює generation і вимагає zero diff. Full session recovery, permissions,
logout і browser → API → MQTT regression належать наступним операціям.
