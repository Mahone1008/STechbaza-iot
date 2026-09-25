# Identity & RBAC Foundation v1

## Мета

Цей документ описує фундамент Етапу 6 — Users, Authentication & RBAC.

Операція 1 не вмикає login і ще не закриває існуючі API endpoints. Вона створює правильну доменну модель identity та tenant access, на яку далі буде накладено authentication і authorization.

## Базова модель

```text
User
  │
  ├── global platform_role
  │
  └── OrganizationMembership
          │
          ├── organization_id
          └── role
```

Глобальна identity і tenant-role навмисно розділені.

Один User може бути членом кількох Organization.

## users

Таблиця:

```text
users
```

Основні поля:

```text
id
email
display_name
password_hash
platform_role
is_active
email_verified_at
last_login_at
created_at
updated_at
```

Password зберігається лише як hash. Plain-text password у БД не передбачений.

На наступній операції буде додано Argon2 hashing та token-based login.

## Platform roles

```text
user
service_admin
superadmin
```

### user

Звичайний користувач. Його доступ визначається OrganizationMembership.

### service_admin

Сервісний співробітник TechBaza. У наступних операціях для нього буде реалізована контрольована cross-tenant policy.

### superadmin

Найвищий системний рівень. Не призначений для звичайної щоденної роботи.

## organization_memberships

Таблиця:

```text
organization_memberships
```

Це many-to-many зв'язок:

```text
User ←→ Organization
```

Один User може працювати в кількох Organization, а одна Organization може мати багато Users.

Поля:

```text
id
organization_id
user_id
role
is_active
created_at
updated_at
```

На пару:

```text
organization_id + user_id
```

діє unique constraint.

## Organization roles

```text
owner
admin
operator
viewer
service
```

Попередня семантика:

```text
owner    → повне керування tenant, включно з access management
admin    → адміністративне керування tenant
operator → керування обладнанням
viewer   → read-only
service  → технічне сервісне обслуговування
```

Точна permission matrix буде введена окремою операцією, а не зашита хаотично в API handlers.

## Multi-tenant принцип

Resource hierarchy:

```text
Organization
   ↓
Site
   ↓
Device
   ↓
Telemetry / Commands
```

Тому access check над Device надалі буде проходити через:

```text
Device
→ Site
→ Organization
→ Membership
→ User
```

Це не дозволить клієнту однієї Organization бачити або керувати Device іншої Organization.

## Чому access не зберігається прямо на Device

Неправильний варіант:

```text
device.user_id
```

Він не масштабується, бо:

- на одному об'єкті можуть працювати кілька людей;
- користувач може бачити кілька sites;
- ролі можуть відрізнятися;
- сервісній команді потрібен окремий рівень доступу.

OrganizationMembership вирішує це на tenant-рівні.

## DB constraints

PostgreSQL захищає допустимі ролі через CHECK constraints.

Також діють:

- unique email;
- unique membership на User + Organization;
- cascade delete memberships при видаленні User або Organization;
- indexes для tenant access queries.

## Security rollout

Етап 6 вводиться поступово, щоб не зламати вже перевірений IoT Core.

```text
Операція 1
Identity & Membership Data Model

Операція 2
Password Security + Login + Access/Refresh Tokens

Операція 3
Authenticated User Context + /me

Операція 4
RBAC + Multi-tenant Resource Guards

Операція 5
Command Audit / Actor Attribution

Операція 6
Security End-to-End Tests
```

До завершення Операції 4 старі endpoints не слід вважати production-secured.

## Migration

```text
20260925_0008_identity_rbac_foundation.py
```

Створює:

```text
users
organization_memberships
```

## Definition of Done Операції 1

- migration застосована;
- tables users та organization_memberships існують;
- CHECK constraints ролей існують;
- unique email існує;
- unique Organization/User membership існує;
- ORM metadata завантажується без помилок;
- backend health працює на версії 0.18.0.
