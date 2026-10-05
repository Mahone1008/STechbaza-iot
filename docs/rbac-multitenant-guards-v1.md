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

[Повна актуальна матриця всіх 16 permissions](generated-code-reference.md#tenant-permissions)
генерується з `backend/app/security/roles.py`, включно з events, alarms,
notifications та `alarm.acknowledge`. Owner/admin мають однаковий набір
атомарних permissions, але membership service додатково захищає owner-role
та останнього owner: [membership management](membership-management-v1.md).

Permission перевіряється централізовано через `AccessControl`, а не окремими role-if у кожному endpoint.

Schema 0022 додає `site_ids` та `expires_at` membership. Прострочений
доступ не чинний; чужий scope повертає 404. Обмежене за Site membership
не дає site.create/membership.read/membership.manage. Owner не може мати
scope або expiry. [Правила create/PATCH](membership-management-v1.md).
Привілейований доступ додатково перевіряє MFA policy, а заводські secrets
вимагають MFA завжди; [точні умови](buyer-onboarding-v1.md).

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

Пряме створення через `POST /organizations` дозволено лише:

```text
superadmin
```

## Resource inheritance

Окремий buyer claim може атомарно створити персональну організацію, owner
і новий об'єкт після перевірки activation code та MFA policy. Це не надає
покупцю права довільного `POST /organizations`; [onboarding](buyer-onboarding-v1.md).

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

Історичний checklist Operation 4.1 (результати наступних підоперацій зафіксовані):

```text
без membership → чужий tenant прихований
operator → read + command execute
operator → create Site заборонено
viewer → read дозволено
viewer → command execute заборонено
tenant A → tenant B resource hidden
```

[Membership management](membership-management-v1.md) та tenant-isolation E2E
реалізовані й перевірені. Поточний CI — у [аудиті](audit-2026-09-30.md).
