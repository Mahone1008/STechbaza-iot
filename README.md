# TechBaza IoT Pump Control

Модульна платформа керування насосами та частотними перетворювачами:
контролери, MQTT, сервер і майбутній web UI. Набір показників та команд
визначається capabilities конкретного пристрою й правами користувача.

Backend: Python/FastAPI, PostgreSQL, SQLAlchemy/Alembic, Mosquitto.
Реалізовано telemetry, command ACK/Result, browser auth, tenant RBAC,
аварії та in-app notifications. Перший frontend ще не реалізовано.

Backend **0.38.0** прийнято 27.09.2026 після повного CI та Windows-перевірки.
**Етап H завершено: 5 із 5 операцій.** Тестова основа готова до Етапу 9.
Актуальний стан і докази: [Етап H](docs/stage-h-backend-corrections.md).

- [Backend: структура й запуск перевірок](backend/README.md).
- [Документація та досьє етапів](docs/README.md).
- [API для frontend](docs/frontend-api-contract-v1.md).
- [Модулі та канали](docs/module-channel-contract-v1.md).
- [Demo-стенд](docs/demo-stand-v1.md), API на `127.0.0.1:8001`.
- [Межі приймання й наступні роботи](docs/test-backend-release-v1.md).

Розробка ведеться поетапно: зміна, автоматичні перевірки, локальне
приймання користувачем, фіксація результату. Production-готовність і
навантаження 10 000 контролерів потребують окремих перевірок.
