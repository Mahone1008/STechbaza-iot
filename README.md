# TechBaza IoT Pump Control / KERUMO

Модульна платформа керування насосами та частотними перетворювачами:
контролери, MQTT, backend і web UI. Набір показників та команд визначається
capabilities конкретного пристрою й правами користувача.

Backend: Python/FastAPI, PostgreSQL, SQLAlchemy/Alembic, Mosquitto.
Реалізовано telemetry, command ACK/Result, browser auth, tenant RBAC,
аварії та in-app notifications.

Backend **0.38.0** прийнято 27.09.2026 після повного CI та Windows-перевірки.
Етап H завершено 5/5.

Frontend Foundation KERUMO також прийнято 27.09.2026:

- Етап 9 завершено **4/4**;
- frontend roadmap — **4/24**;
- Next.js/TypeScript strict foundation;
- design system і responsive shell;
- OpenAPI 0.38.0 / 47 paths;
- shared API adapter і scoped query cache;
- Vitest **7/7**;
- Playwright Chromium **4/4**;
- production build і Windows acceptance — PASS.

Поточна точка — **Етап 10, операція 10.1: справжній browser login
email/password із CSRF та HttpOnly cookie contract**.

- [Backend: структура й запуск перевірок](backend/README.md).
- [Frontend: поточна точка й запуск](frontend/README.md).
- [План frontend 9–14](docs/frontend-roadmap-v1.md).
- [Досьє V3.5 — Етап 9 — Frontend Foundation KERUMO](docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє операції 9.4](docs/stage-9-op4-frontend-baseline.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.

Розробка ведеться поетапно: обмежена зміна, автоматичні перевірки, локальне
приймання користувачем і фіксація результату. Production-готовність,
інтегрована firmware та навантаження 10 000 контролерів потребують окремих етапів.
