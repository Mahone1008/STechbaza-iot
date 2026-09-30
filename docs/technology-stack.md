# Технологічний стек TechBaza / KERUMO

Документ описує реалізацію станом на 30.09.2026.
[Точні версії та registry з коду](generated-code-reference.md),
[поточний статус](project-status.md), [майбутня архітектура](product-readiness-plan-v1.md).

| Рівень | Реалізовано | Ще не прийнято / заплановано |
|---|---|---|
| V3 | ESP32-S3 N16R8, C++, Arduino IDE/CLI, Wi-Fi, Modbus RTU/RS485, профіль SU600 | Інші VFD profiles, повна fault/soak матриця |
| Firmware | Portable control core, NVS ledger/sequence, local ARM/DISARM, read-only та EXTENDED | OTA, fleet provisioning, production runtime; ESP-IDF — пропозиція плану |
| MQTT | Mosquitto, QoS 1, telemetry/heartbeat, commands/ACK/Result; V3 gateway TLS + device password/ACL | Production lifecycle credentials, rotation/revocation, fleet isolation |
| Backend | Python/FastAPI, Pydantic, SQLAlchemy, psycopg, Alembic, paho-mqtt | Розділення API/ingestion/workers для масштабування |
| БД | PostgreSQL 16, доменні дані, snapshots/history, commands/audit, sessions/roles, alarms/notifications | Multiple-instance channels, retention, PITR, capacity acceptance |
| Frontend | Next.js/React, TypeScript strict, TanStack Query, REST із bounded polling | SSE/WebSocket не реалізовані; configuration/provisioning UI — план |
| Simulator | Python, MQTT, SQLite state/ledger/outbox; синтетичні пристрої та faults | Не є моделлю фізики насоса або hardware acceptance |
| Локальна інфраструктура | Docker Compose dev/demo, окремий V3 gateway | Production HTTPS/reverse proxy, monitoring, deployment/restore drills |
| V4 | Очікування 4G-модуля | LTE transport, modem fault/recovery, польове приймання |

Події й аварії формує backend; окремого device `events` MQTT topic зараз немає.
Шляхи повідомлень та версії — у [контракті команд](command-safety-v2.md)
і [телеметрії](telemetry-contract-v1.md).

ESP32 не звертається до PostgreSQL; браузер працює з авторизованим HTTP API.
Modbus є локальним зв'язком ESP32 ↔ VFD; однакова RS485-шина не означає
однакові регістри й правила для всіх SUSWE/інших частотників.
Capabilities описують логічні можливості, а не автоматично виявлені плати.
Один key кожного типу на Device — поточне обмеження v1.

Права перевіряє backend: platform roles `user`, `service_admin`, `superadmin`;
organization roles `owner`, `admin`, `operator`, `viewer`, `service`.
[Точна матриця](generated-code-reference.md), [tenant guards](rbac-multitenant-guards-v1.md).
