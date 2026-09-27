# Backend

Серверна логіка TechBaza IoT: FastAPI, SQLAlchemy/PostgreSQL, Alembic та MQTT.

## Поточний стан

Кандидат **0.38.0**, схема **20260926_0017**. Етапи 1–8 і H-01/H-02/H-03
прийняті. H-04/H-05 очікують остаточного CI та Windows-приймання.
Актуальні докази й статус: [досьє Етапу H](../docs/stage-h-backend-corrections.md).

Реалізовано organization/site/device model, memberships/RBAC, browser auth,
телеметрію та її якість/історію, чергу команд з ACK/Result, аварії й in-app
notifications. API перших екранів відображає enabled capabilities та
типізовані канали конкретного Device. UI ще не реалізовано.

## Запуск і перевірка

Демонстраційний стенд має окремі PostgreSQL/Mosquitto та simulator:
[інструкція demo](../docs/demo-stand-v1.md). Його API працює на
`http://127.0.0.1:8001`; основний dev stack на 8000 є окремим оточенням.

У корені репозиторію, з Docker Desktop і вже прийнятим `.env.demo`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-final.ps1
```

Повне приймання вимагає **158 tests, zero skips**; звичайний unittest без
PostgreSQL/MQTT пропускає інтеграційні перевірки й не є повним gate.
Скрипт також виконує clean install, live demo та exact backup/restore.

Діагностика API:

```text
GET /health
GET /openapi.json
GET /docs
```

`/health` перевіряє HTTP-сервіс та версію; це не доказ справності фізичного VFD.

## Структура та контракти

- `app/api` — HTTP, `schemas` — DTO, `services` — бізнес-логіка.
- `models` / `repositories` — дані; `alembic` — міграції.
- `security` — identity, sessions, права та tenant guards.
- `device_contract.py` — підтримувані канали/команди протоколу v1.
- `demo` / `tools` / `tests` — стенд, операційні перевірки й регресії.

[Frontend API](../docs/frontend-api-contract-v1.md),
[module/channel контракт](../docs/module-channel-contract-v1.md),
[browser auth](../docs/browser-auth-v1.md),
[межі готовності та наступні етапи](../docs/test-backend-release-v1.md).
