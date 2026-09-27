# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

- **9.1 закрито:** UX-сценарії та light industrial SaaS direction.
- **9.2 закрито:** Next.js/TypeScript strict foundation, design system,
  responsive shell і reusable components; local Windows acceptance PASS.
- **9.3 у роботі:** generated OpenAPI types, shared API adapter, normalized
  errors, timeout/cancel, TanStack Query keys і cache lifecycle.
- Login, devices, alarms і dashboard поки використовують typed demo fixtures.
  Єдиний real request у 9.3 — публічний backend `/health` у `/ui-kit`.

## Стек

- Next.js 16.3.6, App Router;
- React / React DOM 19.2.8;
- TypeScript strict;
- TanStack Query 5.104.0;
- OpenAPI TypeScript 7.13.0;
- CSS variables + звичайний CSS;
- ESLint flat config із core-web-vitals і TypeScript rules.

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийнято на Node.js 24.21.0.

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

## Перевірка 9.3

З кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op3.ps1
```

Перевірка й запуск:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op3.ps1 -Start
```

Маршрути:

- `/login` — demo login form;
- `/devices` — demo fleet;
- `/devices/north-pump` — demo modular dashboard;
- `/alarms` — demo incidents;
- `/ui-kit` — components і real `/health` API Contract panel.

## OpenAPI

Backend snapshot: `src/lib/api/openapi.json`.
Generated TypeScript: `src/lib/api/schema.d.ts`.

Regeneration після зміни backend contract:

```powershell
python ..\scripts\export_openapi.py
npm.cmd run api:generate
npm.cmd run api:verify
```

Потрібні Python dependencies backend. CI повторює generation і вимагає zero diff.
