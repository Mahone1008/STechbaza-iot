# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**Етап 9 завершено 4/4. Frontend roadmap: прийнято 4/24.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 реалізовано, CI PASS:** `/login` виконує справжній FastAPI browser
  login із CSRF, HttpOnly refresh cookie, memory-only access token, validation,
  401/403/422/429/network states і real Chromium tests.
- **10.1 ще не закрито:** очікується локальне Windows-приймання користувачем.
- Devices, telemetry, alarms і commands поки використовують typed demo
  fixtures; route guards починаються в 10.3.

[Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).  
[Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).

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

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийнята Stage 9 на
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

## Перевірка операції 10.1

Зупинити попередній Next.js через `Ctrl+C`, потім із кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op1.ps1 -Start
```

Скрипт:

- повторює accepted Stage 9 gate;
- перевіряє Docker Desktop Linux containers;
- зберігає прийняті `.env.demo` і demo volumes;
- застосовує migrations і idempotent seed;
- запускає backend 0.38.0 на `127.0.0.1:8001`;
- виконує real browser login і wrong-password test;
- не друкує demo password;
- запускає KERUMO на `http://127.0.0.1:3000/login`.

Очікуваний результат:

```text
PASS: Stage 10.1 real browser login, CSRF, HttpOnly cookie, memory-only access token and auth error states.
```

Demo email:

```text
owner@techbaza-demo.example.com
```

Скопіювати password без виведення у консоль:

```powershell
$line = Get-Content .env.demo | Where-Object { $_ -like 'DEMO_OWNER_PASSWORD=*' } | Select-Object -First 1
$line.Substring($line.IndexOf('=') + 1) | Set-Clipboard
```

Після успіху UI переходить на `/devices`, показує email та `Сесія
підтверджена · demo data`. Access token не зберігається у localStorage або
sessionStorage. Відновлення після F5 реалізується в 10.2.

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
