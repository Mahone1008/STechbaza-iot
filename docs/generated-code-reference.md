# Довідник поточної реалізації

Генерується `python scripts/check-docs.py --write`. Не редагувати вручну.
CI звіряє його з tracked code. Це перелік реалізації, а не доказ фізичного приймання.
[Статус і відкриті питання](project-status.md).

## Версії

| Компонент | Значення з коду |
|---|---|
| Backend / OpenAPI / health | 0.40.0 |
| Alembic head | `20261001_0019`; 19 міграцій |
| Frontend package | 0.1.0 |
| Node engine | `>=20.9.0` |
| Package manager | `npm@10.9.2` |
| Next.js / React | 16.3.6 / 19.2.8 |
| Firmware V3 | 0.2.2 |
| OpenAPI paths | 47 |

## Канали телеметрії

Джерело: `backend/app/device_contract.py`. Enabled assignment та `telemetry_keys`
обмежують відображення конкретного Device; registry не є переліком встановлених датчиків.

| Capability | source | key | Тип | Одиниця | Series |
|---|---|---|---|---|---|
| `pressure.read` | values | `pressure.bar` | number | bar | так |
| `vfd.current.read` | values | `vfd.current_a` | number | A | так |
| `vfd.diagnostics.read` | state | `control_armed` | boolean | — | ні |
| `vfd.diagnostics.read` | state | `vfd_configuration_valid` | boolean | — | ні |
| `vfd.diagnostics.read` | state | `vfd_link` | boolean | — | ні |
| `vfd.frequency.read` | values | `vfd.frequency_hz` | number | Hz | так |
| `vfd.set_frequency.read` | values | `vfd.set_frequency_hz` | number | Hz | так |
| `vfd.state.read` | state | `emergency_stop` | boolean | — | ні |
| `vfd.state.read` | state | `local_mode` | boolean | — | ні |
| `vfd.state.read` | state | `pump_running` | boolean | — | ні |
| `vfd.state.read` | state | `vfd_fault_code` | integer | — | ні |
| `vfd.voltage.read` | values | `vfd.voltage_v` | number | V | так |
| `water_level.read` | values | `water_level.percent` | number | % | так |

## Підтримувані команди

| Команда | Потрібна capability |
|---|---|
| `vfd.frequency.set` | `vfd.control` |
| `vfd.start` | `vfd.control` |
| `vfd.stop` | `vfd.control` |

Порядок, TTL, профіль частоти й outbound v2: [command-safety-v2](command-safety-v2.md).
ACK/Result лишаються v1. Дозвіл API не замінює локальні блокування VFD.

## Tenant permissions

Джерело: `backend/app/security/roles.py`. Додаткові owner/platform/resource guards
описані в [RBAC](rbac-multitenant-guards-v1.md).

| Permission | owner | admin | operator | viewer | service |
|---|---|---|---|---|---|
| `organization.read` | так | так | так | так | так |
| `site.read` | так | так | так | так | так |
| `site.create` | так | так | — | — | — |
| `device.read` | так | так | так | так | так |
| `device.create` | так | так | — | — | так |
| `telemetry.read` | так | так | так | так | так |
| `event.read` | так | так | так | так | так |
| `alarm.read` | так | так | так | так | так |
| `notification.read` | так | так | так | так | так |
| `alarm.acknowledge` | так | так | так | — | так |
| `command.read` | так | так | так | так | так |
| `command.execute` | так | так | так | — | так |
| `capability.read` | так | так | так | так | так |
| `capability.manage` | так | так | — | — | так |
| `membership.read` | так | так | — | — | — |
| `membership.manage` | так | так | — | — | — |

## HTTP API

Джерело: committed OpenAPI; повні DTO й параметри — `/openapi.json`.
[Авторизація та призначення груп](api-v1.md).

| Path | Methods |
|---|---|
| `/api/v1/alarms/{alarm_id}` | GET |
| `/api/v1/alarms/{alarm_id}/acknowledge` | POST |
| `/api/v1/alarms/{alarm_id}/transitions` | GET |
| `/api/v1/auth/browser/login` | POST |
| `/api/v1/auth/browser/logout` | POST |
| `/api/v1/auth/browser/refresh` | POST |
| `/api/v1/auth/login` | POST |
| `/api/v1/auth/logout` | POST |
| `/api/v1/auth/me` | GET |
| `/api/v1/auth/refresh` | POST |
| `/api/v1/capabilities` | GET, POST |
| `/api/v1/commands/{command_id}` | GET |
| `/api/v1/devices/{device_id}` | GET |
| `/api/v1/devices/{device_id}/alarms` | GET |
| `/api/v1/devices/{device_id}/availability` | GET |
| `/api/v1/devices/{device_id}/capabilities` | GET |
| `/api/v1/devices/{device_id}/capabilities/{capability_id}` | PATCH, POST |
| `/api/v1/devices/{device_id}/commands` | GET, POST |
| `/api/v1/devices/{device_id}/events` | GET |
| `/api/v1/devices/{device_id}/overview` | GET |
| `/api/v1/devices/{device_id}/state` | GET |
| `/api/v1/devices/{device_id}/telemetry` | GET |
| `/api/v1/devices/{device_id}/telemetry/series` | GET |
| `/api/v1/events/{event_id}` | GET |
| `/api/v1/notifications/{notification_id}` | GET |
| `/api/v1/notifications/{notification_id}/read` | POST |
| `/api/v1/organizations` | GET, POST |
| `/api/v1/organizations/{organization_id}` | GET |
| `/api/v1/organizations/{organization_id}/access` | GET |
| `/api/v1/organizations/{organization_id}/memberships` | GET, POST |
| `/api/v1/organizations/{organization_id}/memberships/{membership_id}` | PATCH |
| `/api/v1/organizations/{organization_id}/notifications` | GET |
| `/api/v1/organizations/{organization_id}/notifications/unread-count` | GET |
| `/api/v1/organizations/{organization_id}/sites` | GET, POST |
| `/api/v1/sites/{site_id}` | GET |
| `/api/v1/sites/{site_id}/devices` | GET, POST |
| `/command/reliability/status` | GET |
| `/health` | GET |
| `/health/db` | GET |
| `/health/mqtt` | GET |
| `/mqtt/command/ack/last` | GET |
| `/mqtt/command/last` | GET |
| `/mqtt/command/result/last` | GET |
| `/mqtt/heartbeat/last` | GET |
| `/mqtt/ingestion/last` | GET |
| `/mqtt/last` | GET |
| `/system/alarms/status` | GET |
