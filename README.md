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
- Next.js/TypeScript strict foundation;
- design system і responsive shell;
- OpenAPI 0.38.0 / 47 paths;
- shared API adapter і scoped query cache;
- Vitest, Playwright Chromium і production build — PASS.

Операцію **10.1 — справжній browser login** також прийнято 27.09.2026:

- email/password через FastAPI;
- `X-TechBaza-CSRF` і exact Origin;
- HttpOnly refresh cookie;
- access token лише у пам’яті вкладки;
- 401/403/422/429/network states;
- 11 unit/component tests;
- 9 mocked Chromium tests;
- 2 real backend login tests;
- локальний Windows PASS і ручний redirect на `/devices`.

Поточний статус:

```text
Етап 9: 4/4
Етап 10: 1/4
Frontend roadmap: 5/24
Наступна операція: 10.2 — session recovery після F5
```

- [Backend: структура й запуск перевірок](backend/README.md).
- [Frontend: поточна точка й запуск](frontend/README.md).
- [План frontend 9–14](docs/frontend-roadmap-v1.md).
- [Досьє V3.5 — Етап 9](docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє операції 10.1](docs/stage-10-op1-browser-login.md).
- [Browser authentication contract](docs/browser-auth-v1.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.

Розробка ведеться поетапно: обмежена зміна, автоматичні перевірки, локальне
приймання користувачем і фіксація результату. Production-готовність,
інтегрована firmware та навантаження 10 000 контролерів потребують окремих етапів.
