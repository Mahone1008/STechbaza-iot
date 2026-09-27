# TechBaza IoT Pump Control / KERUMO

Модульна платформа керування насосами та частотними перетворювачами:
контролери, MQTT, backend і web UI. Набір показників та команд визначається
capabilities конкретного пристрою й правами користувача.

Backend: Python/FastAPI, PostgreSQL, SQLAlchemy/Alembic, Mosquitto.
Реалізовано telemetry, command ACK/Result, browser auth, tenant RBAC,
аварії та in-app notifications.

Backend **0.38.0** прийнято 27.09.2026 після повного CI та Windows-перевірки.
Етап H завершено 5/5.

Frontend Foundation KERUMO:

- Етап 9 завершено **4/4**;
- Етап 10 прийнято **2/4**;
- frontend roadmap — прийнято **6/24**;
- Next.js/TypeScript strict foundation;
- design system і responsive shell;
- OpenAPI 0.38.0 / 47 paths;
- shared API adapter і scoped query cache;
- Vitest, Playwright Chromium і production build — PASS.

Операції **10.1 — browser login** і **10.2 — session recovery** прийнято й
закрито після CI та локального Windows-приймання.

Операцію **10.3 — profile, permissions і route guards** реалізовано й
автоматично перевірено:

- `/auth/me` із runtime validation;
- visible organizations і точний organization access;
- real email, display name, organization і role в AppShell;
- permission-aware navigation і controls;
- anonymous protected route → login із safe local `returnTo`;
- tenant data не показуються до завершення access resolution;
- TanStack Query cache ізольовано за `user_id + auth_session_id`;
- owner/viewer перевірено з real FastAPI/PostgreSQL/Chromium;
- 22 unit tests, 19 mocked browser tests і 6 live browser tests — PASS.

10.3 очікує локального Windows-приймання й до цього моменту не вважається
закритою. Device/telemetry/alarm values залишаються typed demo fixtures до
Етапу 11; frontend guard не замінює backend authorization.

Поточний статус:

```text
Етап 9: 4/4
Етап 10: 2/4
Frontend roadmap: 6/24
Поточна точка: локальне приймання 10.3
Після приймання: 10.4 — logout, revoke і no session resurrection
```

- [Backend: структура й запуск перевірок](backend/README.md).
- [Frontend: поточна точка й запуск](frontend/README.md).
- [План frontend 9–14](docs/frontend-roadmap-v1.md).
- [Досьє V3.5 — Етап 9](docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє операції 10.1](docs/stage-10-op1-browser-login.md).
- [Досьє операції 10.2](docs/stage-10-op2-session-recovery.md).
- [Досьє операції 10.3](docs/stage-10-op3-permissions-and-guards.md).
- [Browser authentication contract](docs/browser-auth-v1.md).
- [Current user context](docs/current-user-context-v1.md).
- [RBAC + multi-tenant guards](docs/rbac-multitenant-guards-v1.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.

Розробка ведеться поетапно: обмежена зміна, автоматичні перевірки, локальне
приймання користувачем і фіксація результату. Production-готовність,
інтегрована firmware та навантаження 10 000 контролерів потребують окремих етапів.
