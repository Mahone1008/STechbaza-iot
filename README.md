# TechBaza IoT Pump Control / KERUMO

Модульна платформа керування насосами та частотними перетворювачами:
контролери, MQTT, backend і web UI. Набір показників та команд визначається
capabilities конкретного пристрою й правами користувача.

Backend: Python/FastAPI, PostgreSQL, SQLAlchemy/Alembic, Mosquitto.
Реалізовано telemetry, command ACK/Result, browser auth, tenant RBAC,
аварії та in-app notifications.

Backend **0.38.0** прийнято 27.09.2026 після повного CI та Windows-перевірки.
Етап H завершено 5/5.

Frontend Foundation KERUMO прийнято 27.09.2026:

- Етап 9 завершено **4/4**;
- frontend roadmap — прийнято **5/24**;
- Next.js/TypeScript strict foundation;
- design system і responsive shell;
- OpenAPI 0.38.0 / 47 paths;
- shared API adapter і scoped query cache;
- Vitest, Playwright Chromium і production build — PASS.

Операцію **10.1 — справжній browser login** прийнято й закрито.

Операцію **10.2 — відновлення browser session** реалізовано й автоматично
перевірено:

- F5 recovery через HttpOnly refresh cookie;
- access token тільки у пам’яті;
- proactive refresh та bounded backoff;
- single-flight у межах вкладки;
- Web Locks із lease fallback;
- BroadcastChannel coordination між вкладками;
- один refresh request для двох concurrent tabs;
- temporary network failure не прирівнюється до logout;
- mocked і real Chromium tests — PASS.

Операція 10.2 очікує локального Windows-приймання й до цього моменту не
вважається закритою. Permissions/guards і logout заплановано в 10.3–10.4.

- [Backend: структура й запуск перевірок](backend/README.md).
- [Frontend: поточна точка й запуск](frontend/README.md).
- [План frontend 9–14](docs/frontend-roadmap-v1.md).
- [Досьє V3.5 — Етап 9](docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє операції 10.1](docs/stage-10-op1-browser-login.md).
- [Досьє операції 10.2](docs/stage-10-op2-session-recovery.md).
- [Browser authentication contract](docs/browser-auth-v1.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.

Розробка ведеться поетапно: обмежена зміна, автоматичні перевірки, локальне
приймання користувачем і фіксація результату. Production-готовність,
інтегрована firmware та навантаження 10 000 контролерів потребують окремих етапів.
