# TechBaza IoT Pump Control / KERUMO

Модульна платформа керування насосами й частотними перетворювачами:
ESP32 → MQTT → FastAPI/PostgreSQL → Next.js. Можливості конкретного
пристрою та права користувача визначають доступні показники й команди.

**Поточний стан і відкриті питання:** [project-status](docs/project-status.md).
**Звірення 05.10.2026:** [документація, залежності та межі перевірки](docs/audit-2026-10-05-documentation.md).
Це перевірена база розробки та фізичний стенд V3; production-приймання ще відкрите.

## Запуск

- [Закриті кабінети адміністратора/сервісу та очищення прикладів](docs/staff-console-v1.md).
- [Один сервер, два застосунки, доступ персоналу через VPN](docs/staff-pilot-deployment.md).

- [Сайт і demo на Windows](frontend/README.md): UI `http://127.0.0.1:3000`, API `http://127.0.0.1:8001`.
- [Окреме середовище розробки](docs/local-development.md): API на порту 8000.
- [V3 ESP32-S3 / SU600](docs/v3-su600-bench.md): підготовка, читання й TLS gateway.
- [Випробування з двигуном](docs/v3-su600-extended-test.md): EXTENDED, локальний дозвіл та зупинки.
- [Календарні розклади](docs/control-schedules-v1.md): сезони, часові межі, приймання.
- [Таймер і етапи частоти](docs/control-programs-v1.md): оновлення backend/БД/firmware, контракт і приймання.
- [Місцеве/дистанційне керування та F0.10/F0.11 для SU600](docs/vfd-settings-v1.md): оновлення сайтів та firmware 0.10.0.
- [Ключі облікових записів](docs/account-key-operations-v1.md): обов'язкове перенесення secret перед оновленням старої установки.

30.09.2026 на V3 через Wi-Fi підтверджені читання, START/STOP, зміна частоти,
повторний пуск і три сценарії зупинки. [Докази й обмеження](docs/dossier-v3-su600-control-bench.md).
На V4 оператор підтвердив LTE HTTP через ESP32; додано [PPP/TLS/MQTT підготовку
на сервері Windows](docs/v4-lte-bench.md). Фізичне приймання повного обміну ще відкрите.

[Етап 1 — паспорти, профілі SUSWE та прив’язка команд](docs/equipment-foundation-v1.md).
[Етап 2 — реалізована частина QR/B2B та незавершений фізичний шлях](docs/buyer-onboarding-v1.md).

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

Етап 2: [оновлення сервера, локальні перевірки та весь шлях покупця](docs/stage2-acceptance.md).
