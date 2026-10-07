# Backend

FastAPI, SQLAlchemy/PostgreSQL, Alembic та MQTT. Реалізовані організації,
об'єкти, пристрої, browser auth/session recovery, tenant RBAC, телеметрія,
історія/якість даних, команди, аварії та in-app notifications. Основні екрани
frontend працюють із цими API. `/ui-kit/device-demo` — окремий демонстраційний макет.

[Поточний стан](../docs/project-status.md), [версії та API з коду](../docs/generated-code-reference.md).
Приймання backend 0.38.0 / Етапу H є історичною базою; чинні правила команд —
[protocol v2](../docs/command-safety-v2.md).

## Запуск і перевірки

[Demo](../docs/demo-stand-v1.md) має окремі PostgreSQL/Mosquitto/simulator та API
`http://127.0.0.1:8001`. [Dev stack](../docs/local-development.md) на 8000 — інше оточення.
З кореня репозиторію, з Docker Desktop і налаштованим `.env.demo`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-final.ps1
```

Це повний backend gate: усі зібрані regression tests **без skips**, міграції,
clean install, live demo та exact backup/restore. Кількість тестів і commit
фіксуються результатом запуску, а не старим числом у README.

Швидка перевірка без PostgreSQL/MQTT з папки `backend`:

```powershell
python -m unittest discover -s tests -v
```

Пропуски integration tests у цьому режимі очікувані; це не повне приймання.
Результати поточного звірення — у [звіті](../docs/audit-2026-10-05-documentation.md).

`GET /health` — публічний liveness/version. `/health/db`, `/health/mqtt`,
`/mqtt/last` та `/mqtt/ingestion/last` потребують Bearer superadmin.
[Діагностика](../docs/backend-development.md) не доводить справність фізичного VFD.

## Структура

- `app/api`, `schemas` — HTTP та DTO; `services` — бізнес-логіка.
- `models`, `repositories`, `alembic` — дані та міграції.
- `security` — identity, sessions, permissions та tenant guards.
- `device_contract.py` — спільний registry каналів і підтримуваних команд.
- `mqtt_client.py` — MQTT transport; `mqtt_ingress.py` — обробка повідомлень;
  `mqtt_diagnostics.py` — діагностичний стан; `mqtt_topics.py` — topic helpers.
- `services/account_security.py` — відновлення доступу, TOTP, recovery та сесії;
  `services/onboarding.py` — заводський реєстр і claim; `operations` — preflight/recovery.
- `demo`, `tools`, `tests` — simulator, операційні перевірки та регресії.

API lifespan запускає MQTT і фонові workers. Поточне локальне розгортання
використовує один API-процес; горизонтальне масштабування потребує
розділення runtime та перевірки ownership workers.

[Frontend API](../docs/frontend-api-contract-v1.md),
[канали](../docs/module-channel-contract-v1.md),
[auth](../docs/browser-auth-v1.md), [план продукту](../docs/product-readiness-plan-v1.md).

Перед оновленням наявної установки: [перенесення account keys](../docs/account-key-operations-v1.md).
Поточні lock/static gate: [backend development](../docs/backend-development.md).
Реалізована частина етапу 2: [buyer onboarding](../docs/buyer-onboarding-v1.md).

## Службовий кабінет 0.52.0

[Адміністратор/сервіс, два застосунки, три оформлення, reset та ручні перевірки](../docs/staff-console-v1.md). [Linux pilot через VPN](../docs/staff-pilot-deployment.md). Міграція 0029; staff API запускається як `app.staff_main:app`, обов’язкові окремий JWT secret/audience і `APP_PLANE=staff`.
