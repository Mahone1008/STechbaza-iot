# Досьє V3.5 — Етап 6
## Users, Authentication & RBAC

**Статус:** завершено  
**Версія системи:** V3.5  
**Етап:** 6  
**Backend після завершення:** 0.23.0  
**Дата завершення:** 2026-09-25  
**Операції:** 1–6 завершені

**Мета етапу:** перетворити backend TechBaza з IoT Core на захищену multi-user / multi-tenant платформу з authentication, server-side sessions, RBAC, tenant isolation та незмінним audit автора критичних remote commands.

---

# 1. Стан системи перед Етапом 6

Після Етапу 5 система вже мала:

```text
Device → MQTT → Backend → PostgreSQL
Client → API → durable command → MQTT → Device
Device → ACK / Result → Backend
```

Були готові Device Registry, Sites, Organizations, capabilities, telemetry history, heartbeat, online/offline, ordering protection, reboot/session protection, durable command queue, TTL, idempotency, retry, ACK/Result та broker recovery.

Не вистачало security-контексту:

```text
ХТО виконує request?
ДО ЯКОГО tenant він належить?
ЯКА його актуальна роль?
ЩО йому дозволено?
ХТО створив remote command?
```

---

# 2. Карта Етапу 6

```text
Операція 1 — Identity & Membership Foundation        ✅
Операція 2 — Password Security + Token Auth          ✅
Операція 3 — Current User / Session Context          ✅
Операція 4 — RBAC + Multi-tenant Guards              ✅
Операція 4.2 — Membership Management API             ✅
Операція 5 — Command Actor Audit                     ✅
Операція 6 — Security End-to-End Test                ✅
```

Версії backend:

```text
0.18.0 → Identity & Membership
0.19.0 → Login / Refresh / Logout
0.20.0 → Current User / Session Context
0.21.0 → RBAC + Multi-tenant Guards
0.22.0 → Membership Management
0.23.0 → Command Actor Audit + фінальний security contour
```

---

# 3. Міграції PostgreSQL

```text
20260925_0008_identity_rbac_foundation
20260925_0009_auth_sessions
20260925_0010_command_actor_audit
```

Фінально локально підтверджено:

```text
alembic_version = 20260925_0010 ✅
```

---

# 4. Операція 1 — Identity & Membership Foundation

Базова модель:

```text
User
  │
  ├── platform_role
  │
  └── OrganizationMembership
          ├── organization_id
          └── role
```

Identity і tenant access навмисно розділені. Один User може бути членом кількох Organization і мати різні tenant roles.

Таблиця `users`:

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

Platform roles:

```text
user
service_admin
superadmin
```

Таблиця `organization_memberships`:

```text
id
organization_id
user_id
role
is_active
created_at
updated_at
```

Tenant roles:

```text
owner
admin
operator
viewer
service
```

DB constraints перевірені:

```text
users.email UNIQUE                              ✅
platform_role CHECK                             ✅
membership role CHECK                           ✅
organization_id + user_id UNIQUE                ✅
foreign keys                                    ✅
indexes для tenant access                       ✅
```

Некоректні role values на кшталт `king_of_pumps` блокуються самим PostgreSQL.

---

# 5. Операція 2 — Password Security + Token Authentication

Password зберігається через:

```text
Argon2id
```

Plain-text password у БД не зберігається.

Login endpoint:

```text
POST /api/v1/auth/login
```

Response містить:

```text
access_token
token_type = bearer
expires_in
refresh_token
refresh_expires_in
```

Перевірено:

```text
valid credentials      → 200 ✅
wrong password         → deny ✅
unknown user           → deny ✅
generic error response → ✅
```

Access JWT має default lifetime 15 хвилин та claims `sub`, `sid`, `type`, `jti`, `iss`, `aud`, `iat`, `nbf`, `exp`.

Ключове рішення: tenant role не є source of truth усередині JWT.

Refresh token — opaque random secret з default lifetime 30 днів. У PostgreSQL зберігається тільки SHA-256 hash refresh token.

---

# 6. auth_sessions, refresh rotation та logout

`auth_sessions` містить:

```text
id
user_id
refresh_token_hash
expires_at
revoked_at
last_used_at
created_at
updated_at
```

Refresh flow:

```text
old refresh token
  ↓
row lock
  ↓
session validation
  ↓
new access token
  ↓
new refresh token
  ↓
hash replacement
```

Перевірено:

```text
refresh працює                         ✅
старий refresh після rotation → 401    ✅
last_used_at оновлюється               ✅
```

Logout endpoint:

```text
POST /api/v1/auth/logout
```

встановлює `auth_sessions.revoked_at`.

---

# 7. Операція 3 — Current User / Session Context

Endpoint:

```text
GET /api/v1/auth/me
```

Authenticated request перевіряється так:

```text
Bearer token
  ↓
JWT signature / issuer / audience / exp
  ↓
sub + sid
  ↓
User lookup
  ↓
AuthSession lookup
  ↓
session belongs to User
  ↓
session not revoked / not expired
  ↓
User active
  ↓
CurrentUserContext
```

Backend не довіряє лише математично валідному JWT: потрібна активна server-side session.

`/auth/me` повертає identity, auth_session_id, expiry та active memberships, але не повертає password hash або refresh token.

---

# 8. Операція 4 — RBAC + Multi-tenant Guards

Введений централізований `AccessControl`:

```text
CurrentUserContext
  ↓
Membership
  ↓
Role
  ↓
Permission
  ↓
Resource tenant scope
  ↓
allow / deny
```

Permission logic не розмазана по endpoint handlers.

## Permission Matrix v1

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

---

# 9. Tenant hierarchy та isolation

```text
Organization
  ↓
Site
  ↓
Device
  ↓
Telemetry / Commands
```

Для Device access backend проходить `Device → Site → Organization → Membership → Permission`.

Чужий tenant/resource повертає:

```text
404
Ресурс не знайдено
```

а не 403. Це anti-enumeration policy: User не може відрізнити чужий UUID від реально неіснуючого.

`superadmin` має platform bypass. `service_admin` не отримує автоматичний доступ до всіх tenants — для customer data потрібне explicit active membership.

---

# 10. Операція 4.2 — Membership Management API

Endpoints:

```text
GET   /api/v1/organizations/{organization_id}/memberships
POST  /api/v1/organizations/{organization_id}/memberships
PATCH /api/v1/organizations/{organization_id}/memberships/{membership_id}
```

Hard delete не використовується; revoke access робиться через `is_active=false` для кращого audit trail.

Перевірено:

```text
admin → list memberships            ✅
admin → add viewer                  ✅
admin → viewer → operator           ✅
admin → assign owner                ❌ 403
operator → membership list          ❌ 403
owner → assign другого owner        ✅
owner → downgrade другого owner     ✅
```

Last active owner invariant:

```text
останній active owner
  ↓
спроба downgrade/deactivate
  ↓
409 Conflict
```

Response: `Не можна прибрати останнього активного owner організації`.

---

# 11. Операція 5 — Command Actor Audit

До `device_commands` додані:

```text
actor_user_id
actor_auth_session_id
actor_organization_id
actor_platform_role
actor_organization_role
actor_email
actor_display_name
```

Legacy commands можуть мати `actor_* = null`.

Actor metadata — immutable historical snapshot. Якщо User створив command як owner, а потім став viewer, стара command продовжує показувати `actor_organization_role=owner`.

Actor-aware idempotency також перевіряє автора: інший User не може повторно використати чужий `request_id`.

Перевірено:

```text
User A → request_id X → command created   ✅
User B → request_id X → conflict          ✅
```

---

# 12. Операція 6 — Security End-to-End Test

Фінальний E2E chain:

```text
login
  ↓
auth session
  ↓
JWT
  ↓
tenant membership
  ↓
RBAC
  ↓
Device access
  ↓
command execute
  ↓
actor audit
  ↓
live role change
  ↓
permission update
  ↓
logout
  ↓
session revoke
  ↓
foreign tenant isolation
```

## 12.1. Login + Device access

Перевірено owner login, active auth session, owner membership та GET Device `TB-ESP32-001`.

Target:

```text
organization_id = 2b60bce4-0d34-43f7-a5ec-2e674e64684f
device_id       = 41a7a0ee-72df-4655-8572-b823ec320195
device_uid      = TB-ESP32-001
```

## 12.2. Owner command execute

Перевірена command:

```text
command_id = a4ceb69f-aae7-4f80-ae63-b318bcff9d16
request_id = c31c73cd-6820-4dfe-9359-c39bd56fd175
command_type = vfd.frequency.set
frequency_hz = 44
```

Actor snapshot:

```text
actor_user_id = 8fa4670a-f551-4faa-ab9a-273936f2ff22
actor_auth_session_id = ebf1d3cc-53ec-42e3-8991-928d7f106a1b
actor_organization_id = 2b60bce4-0d34-43f7-a5ec-2e674e64684f
actor_platform_role = user
actor_organization_role = owner
actor_email = viewer-test@techbaza.dev
actor_display_name = Viewer Test
```

`actor_auth_session_id` збігся з `/auth/me`.

## 12.3. Persisted audit

Окремий `GET /api/v1/commands/{command_id}` повернув ті самі `actor_*` поля. Отже audit persisted у PostgreSQL, а не існує лише в POST response.

## 12.4. Live role change

Без нового login і без нового JWT роль була змінена `owner → viewer`.

Тим самим access token:

```text
GET /auth/me → role=viewer        ✅
POST command → 403                ✅
```

Це доводить, що permissions беруться з актуального server-side membership state.

## 12.5. Logout / Session Revoke

Після logout:

```text
old access JWT → /auth/me → 401                         ✅
old refresh token → /auth/refresh → 401                 ✅
```

Server-side revocation працює негайно.

## 12.6. Foreign Tenant Anti-enumeration

Перевірено:

```text
чужа Organization aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa → 404
чужий Device cccccccc-cccc-4ccc-8ccc-cccccccccccc      → 404
неіснуюча Organization 99999999-9999-4999-8999-999999999999 → 404
```

Усі повернули однакове `Ресурс не знайдено`.

---

# 13. Фінальний security checklist

```text
Argon2id password hashing                           ✅
generic invalid-login response                      ✅
access JWT                                          ✅
server-side auth sessions                           ✅
refresh hash only in DB                             ✅
refresh rotation                                    ✅
logout revoke                                       ✅
old access JWT after logout → 401                   ✅
old refresh after logout → 401                      ✅

CurrentUserContext                                  ✅
OrganizationMembership                             ✅
live role resolution                                ✅
central permission matrix                           ✅
RBAC guards                                         ✅
multi-tenant scope                                  ✅
foreign-resource anti-enumeration                   ✅

Membership Management API                           ✅
owner protection                                    ✅
last active owner invariant                         ✅

Command actor attribution                           ✅
actor session attribution                           ✅
actor role snapshot                                 ✅
immutable historical audit                          ✅
foreign actor request_id conflict                   ✅
```

---

# 14. Фінальна security architecture

```text
Client / UI
   │
   ▼
/auth/login
   │
   ├── Access JWT
   └── Refresh Token
          │
          ▼
     auth_sessions
          │
          ▼
  CurrentUserContext
          │
          ▼
OrganizationMembership
          │
      role → permission
          │
          ▼
     AccessControl
          │
     tenant scope
          │
          ▼
Organization / Site / Device / Telemetry / Commands
          │
          ▼
device_commands + immutable actor audit
```

---

# 15. Source of truth після Етапу 6

```text
User identity             → users
Authentication lifecycle  → auth_sessions
Tenant access             → organization_memberships
Permissions               → centralized RBAC policy
Tenant ownership          → Organization / Site hierarchy
Command lifecycle         → device_commands
Historical command actor  → device_commands.actor_*
```

---

# 16. Ключові архітектурні рішення

1. **Identity ≠ Membership.** User може належати кільком Organization.
2. **Platform role ≠ Tenant role.** Системний рівень не змішаний із клієнтською роллю.
3. **JWT ≠ остаточне джерело permissions.** Актуальна role читається server-side.
4. **Server-side session перевіряється на authenticated request.**
5. **RBAC централізований через AccessControl.**
6. **Чужий tenant повертає 404, а не 403.**
7. **Last active owner захищений invariant-ом.**
8. **Remote commands мають immutable actor snapshot.**
9. **Інший User не може повторно використати чужий request_id.**
10. **DB constraints доповнюють application validation.**

---

# 17. API, додані або принципово захищені

Authentication:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Memberships:

```text
GET   /api/v1/organizations/{organization_id}/memberships
POST  /api/v1/organizations/{organization_id}/memberships
PATCH /api/v1/organizations/{organization_id}/memberships/{membership_id}
```

RBAC guards отримали Organizations, Sites, Devices, Availability, Telemetry, State, Commands, Capabilities та Memberships.

---

# 18. Development bootstrap

Public self-registration у цьому етапі навмисно не відкривалась.

Development User створюється CLI:

```text
python -m app.tools.create_user
```

Password вводиться через hidden prompt. Тестові passwords у досьє навмисно не дублюються.

---

# 19. Що не входить у Етап 6

Окремими майбутніми layers залишаються:

```text
public self-registration
email verification workflow
forgot/reset password UX
MFA / TOTP
SSO / OIDC / SAML
external API keys
fine-grained per-Site ACL
frontend login screens
production secret manager
rate limiting / WAF
centralized security event pipeline
```

Це не дефекти поточного security core.

---

# 20. Межа production readiness

Етап 6 закрив **backend security foundation**.

Перед зовнішнім production deployment окремо потрібні HTTPS/TLS, production secrets, backup policy, observability, rate limiting, infrastructure hardening та security review.

---

# 21. Фінальний локальний test state

Під час E2E ролі навмисно змінювалися. Після завершення перевірок:

```text
stage6-admin@techbaza.dev  → owner
viewer-test@techbaza.dev   → viewer
```

---

# 22. Документація Етапу 6

- [Етап 6 — Users, Authentication & RBAC](stage-6-users-auth-rbac.md)
- [Identity & RBAC Foundation v1](identity-rbac-foundation-v1.md)
- [Authentication Token Protocol v1](auth-token-v1.md)
- [Current User / Session Context v1](current-user-context-v1.md)
- [RBAC + Multi-tenant Guards v1](rbac-multitenant-guards-v1.md)
- [Membership Management v1](membership-management-v1.md)
- [Command Actor Audit v1](command-actor-audit-v1.md)
- [Security End-to-End Test v1](security-e2e-test-v1.md)

---

# 23. Definition of Done

```text
Identity data model                         ✅
Organization memberships                   ✅
Platform roles                             ✅
Tenant roles                               ✅
DB constraints                             ✅
Password hashing                           ✅
Login / Access JWT / Refresh               ✅
Refresh rotation                           ✅
Logout / session revoke                    ✅
CurrentUserContext                         ✅
/auth/me                                   ✅
Central RBAC                               ✅
Multi-tenant guards                        ✅
Anti-enumeration                           ✅
Membership Management API                  ✅
Owner protection                           ✅
Last-owner invariant                       ✅
Command actor audit                        ✅
Immutable role snapshot                    ✅
Actor-aware idempotency                    ✅
Security E2E                               ✅
Live role downgrade                        ✅
Old-token rejection                        ✅
Foreign tenant isolation                   ✅
```

**Етап 6 завершено.**

---

# 24. Handoff до Етапу 7

Етап 6 закрив питання:

```text
Хто виконує дію?
У якому tenant?
Яка його актуальна роль?
Який permission потрібен?
До якого ресурсу є доступ?
Хто створив критичну remote command?
```

Наступні product/backend layers можуть використовувати готовий security context:

```text
CurrentUserContext
+
Organization scope
+
Permission
+
Actor audit
```

Етапу 7 не потрібно повторно будувати authentication або tenant isolation.

**Security foundation V3.5 вважається завершеним.**
