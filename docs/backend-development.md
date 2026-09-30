# Backend — локальна розробка та діагностика

Запуск, міграції й порти: [local-development](local-development.md).
Сайт використовує [demo API](demo-stand-v1.md) на 8001, якщо `.env.local`
frontend не задає іншої адреси. Dev API на 8000 має власну БД.

## HTTP

| Маршрут | Доступ | Що перевіряє |
|---|---|---|
| `/health` | Публічний | Liveness процесу та версію; не DB/MQTT/VFD readiness |
| `/openapi.json`, `/docs` | Публічний | Поточну машинну схему та Swagger |
| `/health/db` | Bearer superadmin | SQL-запит до PostgreSQL |
| `/health/mqtt` | Bearer superadmin | Підключення backend до broker |
| `/mqtt/last` | Bearer superadmin | Останній діагностичний MQTT message |
| `/mqtt/ingestion/last` | Bearer superadmin | Результат обробки telemetry/heartbeat/ACK/Result |

Звичайні demo users не є superadmin. Відповідь 401/403 на діагностиці
сама по собі не означає несправність MQTT. Для оператора доступні
авторизовані overview, availability, command journal та alarms.

Діагностичний topic `techbaza/test/backend` не є telemetry конкретного Device.
Для dev broker тестове повідомлення можна надіслати так:

```powershell
docker compose exec -T mosquitto mosquitto_pub -h localhost -t techbaza/test/backend -m "message for backend"
```

Потім перевірте `/mqtt/last` з чинним Bearer superadmin. Саме повідомлення
не оновлює physical device presence або показання SU600.

## Перевірки

[Backend README](../backend/README.md) містить повний Windows gate.
GitHub Actions запускає integration suite з PostgreSQL/MQTT, міграції,
ізольований demo та backup/restore. Поточні результати з commit/межами —
[аудит](audit-2026-09-30.md). Python unittest без opt-in сервісів пропускає
integration tests і не замінює цей gate.

API/controllers, services, repositories та security guards перевіряються
разом. Зміни HTTP DTO потребують `scripts/export_openapi.py`, frontend
`npm run api:generate` та committed OpenAPI zero diff.
