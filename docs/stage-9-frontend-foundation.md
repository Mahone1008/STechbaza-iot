# Етап 9 — Frontend Foundation KERUMO

Дата завершення: 27.09.2026. Backend base: **0.38.0**.

**Статус: завершено 4/4. Frontend roadmap: 4/24.**

## 1. Результат етапу

Етап 9 перетворив погоджений UX-напрямок KERUMO на відтворювану
production-oriented frontend-основу. Реальний login, live fleet, telemetry,
commands та alarms ще не підключені, але для них уже існують типізовані
контракти, API boundary, дизайн-система й автоматичні перевірки.

Завершені операції:

1. **9.1 — UX-сценарії та макети**: light industrial SaaS visual direction,
   desktop/mobile hierarchy, ролі, модульність, data/command states.
2. **9.2 — Каркас і компоненти**: Next.js App Router, React, TypeScript strict,
   responsive shell, design tokens і reusable primitives.
3. **9.3 — API adapter і контракти**: OpenAPI snapshot, generated TypeScript,
   timeout/cancel, normalized errors, TanStack Query scopes і real `/health`.
4. **9.4 — Відтворюваний baseline**: clean install, Vitest, Playwright
   Chromium, production build, GitHub Actions і Windows acceptance.

## 2. Зафіксований стек

- Next.js **16.3.6**;
- React / React DOM **19.2.8**;
- TypeScript strict;
- TanStack Query **5.104.0**;
- OpenAPI TypeScript **7.13.0**;
- Vitest **5.0.2**;
- Playwright **1.63.0**;
- CSS variables + звичайний CSS;
- Node.js **20.9.0+**.

Exact dependency graph зберігається у `frontend/package-lock.json`.

## 3. Структура

```text
frontend/
  src/app/                 Next.js routes
  src/components/          reusable UI і shell
  src/features/            login, devices, alarms, ui-kit demo features
  src/lib/api/             config, client, errors, endpoints, query policy
  src/lib/api/openapi.json backend contract snapshot
  src/lib/api/schema.d.ts  generated TypeScript contract
  tests/browser/           Chromium smoke tests
  playwright.config.ts
  vitest.config.mts
```

Основні routes:

```text
/login
/devices
/devices/{deviceId}
/alarms
/ui-kit
```

## 4. API boundary

OpenAPI contract:

- OpenAPI **3.1.0**;
- backend **0.38.0**;
- **47 paths**;
- regeneration і zero-diff verification у CI.

Shared API adapter підтримує:

- JSON headers;
- optional Bearer token;
- CSRF header;
- `credentials: include`;
- timeout і AbortSignal;
- `cache: no-store`;
- normalized 401/403/404/409/422/429/5xx/network/timeout errors;
- `Retry-After`;
- bounded read retry;
- `retry: false` для mutations.

Cache keys мають user/session/tenant/device scope. Cache не зберігається у
localStorage, а logout/context switch повинні cancel-ити й видаляти старий scope.

## 5. Автоматичні перевірки

Фінальний read-only GitHub Actions gate:

- run **36325337149** — success;
- повтор після Windows `.venv` fix: run **36325843460** — success;
- `npm ci` за tracked lockfile;
- OpenAPI export і zero diff;
- typecheck;
- ESLint;
- **7/7** unit/component tests;
- production build, **7 routes**;
- **4/4** Playwright Chromium tests.

Browser smoke перевіряє:

- login labels;
- fleet → Device navigation;
- explicit demo state;
- confirmation перед critical action;
- відсутність неправдивого physical Result;
- API success окремо від network failure;
- mobile navigation.

## 6. Локальне приймання

Користувач виконав `scripts/check-stage9-op4.ps1 -Start` на Windows:

- Node.js **24.21.0**;
- project-local `.venv` із backend dependencies;
- OpenAPI **0.38.0 / 47 paths**;
- Vitest **7 passed**;
- Playwright **4 passed**;
- production build — PASS;
- KERUMO запущено на `http://127.0.0.1:3000`.

Підтверджено фінальний рядок:

```text
PASS: Stage 9.4 clean install, API contract, unit tests, production build and Chromium smoke tests.
```

## 7. Межі готовності

Після Етапу 9 готові фундамент і перевірки, але ще не готові:

- реальний login/session UI;
- refresh coordinator;
- route guards;
- live organizations/sites/devices;
- live telemetry, charts і polling;
- command writes;
- alarms/notifications UI;
- production deployment.

Demo fixtures залишаються явно позначеними й не видаються за live data.

## 8. Наступний етап

**Етап 10 — вхід, сесія та права.**

Поточна операція: **10.1 — справжній browser login email/password** за чинним
FastAPI contract із CSRF, HttpOnly refresh cookie, `credentials: include`,
normalized auth errors і rate-limit states.
