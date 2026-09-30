# TechBaza IoT Pump Control / KERUMO

Модульна платформа керування насосами й частотними перетворювачами:
ESP32 → MQTT → FastAPI/PostgreSQL → Next.js. Можливості конкретного
пристрою та права користувача визначають доступні показники й команди.

**Поточний стан і відкриті питання:** [project-status](docs/project-status.md).
**Аудит 30.09.2026:** [виправлення, перевірки та межі готовності](docs/audit-2026-09-30.md).
Це перевірена база розробки та фізичний стенд V3; production-приймання ще відкрите.

## Запуск

- [Сайт і demo на Windows](frontend/README.md): UI `http://127.0.0.1:3000`, API `http://127.0.0.1:8001`.
- [Окреме середовище розробки](docs/local-development.md): API на порту 8000.
- [V3 ESP32-S3 / SU600](docs/v3-su600-bench.md): підготовка, читання й TLS gateway.
- [Випробування з двигуном](docs/v3-su600-extended-test.md): EXTENDED, локальний дозвіл та зупинки.

30.09.2026 на V3 через Wi-Fi підтверджені читання, START/STOP, зміна частоти,
повторний пуск і три сценарії зупинки. [Докази й обмеження](docs/dossier-v3-su600-control-bench.md).
V4 відкладено до отримання 4G-модуля.

## Навігація

| Частина | Де читати |
|---|---|
| Поточні версії, API, канали й права з коду | [Генерований довідник](docs/generated-code-reference.md) |
| Backend, перевірки | [backend/README.md](backend/README.md) |
| Frontend, перевірки | [frontend/README.md](frontend/README.md) |
| Firmware | [firmware/README.md](firmware/README.md) |
| Інфраструктура й БД | [infrastructure](infrastructure/README.md), [database](database/README.md) |
| Чинні контракти, runbooks, історичні досьє | [Каталог документації](docs/README.md) |
| План продукту та приймання UI | [P0–P9](docs/product-readiness-plan-v1.md), [frontend 9–14](docs/frontend-roadmap-v1.md) |

Історичні числа тестів і статуси етапів залишаються в датованих досьє.
Вони не замінюють перевірку поточного commit та актуальний статус вище.
