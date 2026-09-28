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
- Етап 10 завершено **4/4**;
- frontend roadmap — прийнято **10/24**;
- Next.js/TypeScript strict foundation;
- design system і responsive shell;
- OpenAPI 0.38.0 / 47 paths;
- shared API adapter і session-scoped query cache;
- Vitest, Playwright Chromium і production build — PASS.

Операції **10.1 — browser login**, **10.2 — session recovery** і
**10.3 — profile, permissions і route guards** прийнято й закрито після CI
та локального Windows-приймання.

Операцію **10.4 — logout, revoke і no session resurrection** реалізовано й
автоматично перевірено:

- real `POST /api/v1/auth/browser/logout` із Origin/CSRF/cookie contract;
- revoke поточної server-side session і видалення HttpOnly refresh cookie;
- старий access token відхиляється backend до natural JWT expiry;
- tenant content приховується від початку logout intent;
- active authorized requests скасовуються;
- session-scoped cache очищується, public cache зберігається;
- logout однієї вкладки очищує всі same-origin вкладки;
- короткоживучий logout marker не містить tokens, email або tenant ids;
- F5 і новий protected route не відновлюють завершену session;
- ambiguous network/5xx result не видається за успішний logout;
- `429 Retry-After` керує повторною спробою;
- 23 unit tests, 23 mocked browser tests і 8 live browser tests — PASS.

Операцію **10.4** прийнято й закрито після локального Windows-приймання.
**11.1 і 11.2 реалізовано разом:** реальні org/site/device lists, breadcrumbs,
перевірені deep links/restore та bounded availability. Виявлену у Windows
гонку login navigation виправлено. Повторний CI: **31 unit / 40 mocked /
10 live — PASS**, ще **10 повторів** регресій login/refresh без retries — PASS.
Повторний Windows-прогін: **31 / 40 / 10 — PASS**; каталог організацій і список
пристроїв підтверджені скриншотами. Решту ручних сценаріїв користувач підтвердив
28.09.2026: **11.1 і 11.2 прийнято й закрито**. [Досьє 11.2](docs/stage-11-op2-device-list.md).
**11.3 і 11.4 реалізовано разом:** [модульна панель](docs/stage-11-op3-module-widgets.md),
[якість і зміни конфігурації](docs/stage-11-op4-quality-and-configuration.md).
CI: **42 unit / 52 mocked / 10 live — PASS**, додаткові 25 повторів регресій
без retries — PASS. Windows 28.09.2026: **42 / 52 / 10 — PASS**;
панель насоса підтверджено скриншотами. Залишилися окремі ручні сценарії 11.3/11.4.
**12.1 і 12.2 реалізовано разом:** [історія телеметрії](docs/stage-12-op1-telemetry-history.md)
та [політика оновлення](docs/stage-12-op2-polling.md). **CI: 61 unit / 71 mocked /
10 live та 34 додаткові повтори регресій — PASS.** Windows 28.09.2026: **54 / 63 / 10 — PASS**, графіки підтверджено.
Виправлення прокрутки пройшло CI; очікується повторна ручна перевірка.
Додано [збереження фільтрів після F5](docs/stage-12-history-preferences-2026-09-28.md); CI **61/71/10 + 34 повтори — PASS**; очікується ручна перевірка F5. Реалізовано **[12.3 — команди](docs/stage-12-op3-command-controls.md)** і **[12.4 — lifecycle та журнал](docs/stage-12-op4-command-journal.md)**; результати перевірок і Windows-команда — у досьє 12.4. Alarms поки демонстраційні.

Поточний статус:

```text
Етап 9: 4/4
Етап 10: 4/4
Frontend roadmap: 10/24
Етап 11: реалізовано 4/4, прийнято 2/4; CI + Windows PASS, залишок ручного приймання
Етап 12: реалізовано 4/4; нові 12.3 + 12.4 очікують Windows і ручного приймання
```

- [11.1 — Організації та об’єкти](docs/stage-11-op1-organizations-sites.md).
- [11.2 — Пристрої, перевірки й Windows-команда](docs/stage-11-op2-device-list.md).
- [Backend: структура й запуск перевірок](backend/README.md).
- [Frontend: поточна точка й запуск](frontend/README.md).
- [План frontend 9–14](docs/frontend-roadmap-v1.md).
- [Досьє V3.5 — Етап 9](docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє V3.5 — Етап 10](docs/dossier-v3.5-stage-10-browser-auth-session-rbac.md).
- [Досьє V3.5 — Етап 11](docs/dossier-v3.5-stage-11-inventory-modular-dashboard.md).
- [Досьє операції 10.1](docs/stage-10-op1-browser-login.md).
- [Досьє операції 10.2](docs/stage-10-op2-session-recovery.md).
- [Досьє операції 10.3](docs/stage-10-op3-permissions-and-guards.md).
- [Досьє операції 10.4](docs/stage-10-op4-logout-and-failures.md).
- [Browser authentication contract](docs/browser-auth-v1.md).
- [Current user context](docs/current-user-context-v1.md).
- [RBAC + multi-tenant guards](docs/rbac-multitenant-guards-v1.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.

Розробка ведеться поетапно: обмежена зміна, автоматичні перевірки, локальне
приймання користувачем і фіксація результату. Production-готовність,
інтегрована firmware та навантаження 10 000 контролерів потребують окремих етапів.
