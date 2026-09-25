# RBAC + Multi-tenant Guards v1

## Мета

Операція 4 переводить API TechBaza з authenticated-only у tenant-scoped authorization.

Кожний request до клієнтського ресурсу тепер проходить:

```text
Authentication
    ↓
Current User
    ↓
Tenant membership
    ↓
Role → Permission
    ↓
Resource scope
    ↓
Endpoint
```

## Tenant roles

```text
owner
admin
operator
viewer
service
```

## Permission matrix v1

| Permission | owner | admin | operator | viewer | service |
|---|---:|---:|---:|---:|---:|
| organization.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| site.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| site.create | ✅ | ✅ | ❌ | ❌ | ❌ |
| device.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| device.create | ✅ | ✅ | ❌ | ❌ | ✅ |
| telemetry.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| command.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| command.execute | ✅ | ✅ | ✅ | ❌ | ✅ |
| capability.read | ✅ | ✅ | ✅ | ✅ | ✅ |
| capability.manage | ✅ | ✅ | ❌ | ❌ | ✅ |
| membership.read | ✅ | ✅ | ❌ | ❌ | ❌ |
| membership.manage | ✅ | ✅ | ❌ | ❌ | ❌ |

Permission перевіряється централізовано через `AccessControl`, а не окремими role-if у кожному endpoint.

## Platform roles

```text
user
service_admin
superadmin
```

### superadmin

`superadmin` має platform-level bypass tenant membership для адміністративного доступу.

### service_admin

`service_admin` не отримує автоматичний доступ до всіх клієнтів.

Для tenant data йому потрібне explicit active membership у потрібній Organization. Це дозволяє сервісному персоналу TechBaza мати контрольований cross-tenant scope без глобального доступу.

Capability catalog creation дозволено:

```text
service_admin
superadmin
```

Створення нового Organization наразі дозволено лише:

```text
superadmin
```

## Resource inheritance

Tenant ownership визначається по ланцюжку:

```text
Organization
    ↓
Site.organization_id
    ↓
Device.site_id
    ↓
Telemetry.device_id
    ↓
Command.device_id
```

Тому перевірка Device автоматично визначає Organization через Site.

## Anti-enumeration

Для authenticated User без membership чужий ресурс повертає:

```text
404 Resource not found
```

а не `403`.

Це навмисно: User не повинен мати можливість перебирати UUID та визначати, які чужі Organization / Site / Device реально існують.

Якщо membership існує, але tenant-role не має потрібного permission:

```text
403 Недостатньо прав для цієї дії
```

## Protected API

RBAC guard підключено до:

```text
GET  /api/v1/organizations
GET  /api/v1/organizations/{organization_id}
POST /api/v1/organizations

GET  /api/v1/organizations/{organization_id}/sites
POST /api/v1/organizations/{organization_id}/sites
GET  /api/v1/sites/{site_id}

GET  /api/v1/sites/{site_id}/devices
POST /api/v1/sites/{site_id}/devices
GET  /api/v1/devices/{device_id}
GET  /api/v1/devices/{device_id}/availability

GET  /api/v1/devices/{device_id}/telemetry
GET  /api/v1/devices/{device_id}/state

POST /api/v1/devices/{device_id}/commands
GET  /api/v1/devices/{device_id}/commands
GET  /api/v1/commands/{command_id}

GET  /api/v1/capabilities
POST /api/v1/capabilities
GET  /api/v1/devices/{device_id}/capabilities
POST /api/v1/devices/{device_id}/capabilities/{capability_id}
```

## Organization listing

Звичайний User бачить лише Organization з active membership.

`superadmin` бачить platform list.

## Межа Operation 4.1

Operation 4.1 створює permission matrix та накладає guards на існуючі business endpoints.

Наступна перевірка повинна довести:

```text
без membership → чужий tenant прихований
operator → read + command execute
operator → create Site заборонено
viewer → read дозволено
viewer → command execute заборонено
tenant A → tenant B resource hidden
```

Membership management API та повний tenant-isolation E2E закриваються наступними підопераціями Operation 4.
