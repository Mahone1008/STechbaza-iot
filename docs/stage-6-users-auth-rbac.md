# Етап 6 — Users, Authentication & RBAC

**Статус:** у роботі  
**Backend:** 0.23.0+

## Мета

Перетворити готовий IoT Core на безпечний multi-user / multi-tenant backend.

Після цього етапу:

- користувач входить у систему під власним account;
- backend знає, хто саме виконує HTTP request;
- клієнт бачить лише свої Organization / Site / Device;
- operator може керувати обладнанням, але не керувати користувачами;
- viewer має read-only доступ;
- service role має контрольований технічний доступ;
- service_admin TechBaza може працювати з дозволеним cross-tenant scope;
- кожна remote command матиме actor/audit attribution.

## Архітектурний принцип

```text
Authentication
Хто ти?
   ↓
Authorization
Що тобі дозволено?
   ↓
Tenant scope
До чиїх ресурсів ти маєш доступ?
   ↓
Audit
Хто виконав конкретну дію?
```

Ці чотири поняття не змішуються.

## План операцій

```text
Операція 1 — Identity & Membership Foundation      ✅ завершено
Операція 2 — Password Security + Token Auth         ✅ завершено
Операція 3 — Current User / Session Context          ✅ завершено
Операція 4 — RBAC + Multi-tenant Guards              ✅ завершено
Операція 5 — Command Actor Audit                         ← у роботі
Операція 6 — Security End-to-End Test
```

## Операція 1 — Identity & Membership Foundation

Додається:

```text
users
organization_memberships
```

Розділяються два рівні ролей:

```text
platform_role
→ user
→ service_admin
→ superadmin

organization role
→ owner
→ admin
→ operator
→ viewer
→ service
```

Це важливо: глобальний статус працівника платформи не повинен підміняти tenant-role клієнта.

Migration:

```text
20260925_0008_identity_rbac_foundation
```

Документ:

[Identity & RBAC Foundation v1](identity-rbac-foundation-v1.md)

## Важлива межа безпеки

Операція 1 створює schema foundation, але ще не вмикає authorization guards на старих endpoints.

До Операції 4 локальний API залишається development API.

Production exposure до завершення access-control rollout не допускається.


## Schema verification 2026-09-25

Після migration `20260925_0008` локально підтверджено:

```text
users table                                      ✅
organization_memberships table                  ✅
users.email UNIQUE                              ✅
users.platform_role CHECK                       ✅
organization_memberships role CHECK             ✅
organization_id → organizations.id FK           ✅
user_id → users.id FK                           ✅
UNIQUE (organization_id, user_id)               ✅
ON DELETE CASCADE для membership relations      ✅
```

Backend health:

```text
version = 0.18.0 ✅
```

Поведінкову перевірку DB constraints завершено.


## Behavioral constraint verification

Локально перевірено:

```text
коректний User INSERT                                  ✅
platform_role='king_of_pumps' → CHECK violation       ✅
коректний Membership INSERT                            ✅
role='king_of_pumps' → CHECK violation                ✅
DELETE User при існуючому Membership                  ✅
ON DELETE CASCADE не блокує видалення                 ✅
```

Операція 1 — Identity & Membership Foundation завершена.


## Операція 2 — Password Security + Token Auth

Реалізовано:

```text
Argon2id password hashing
short-lived JWT access token
opaque random refresh token
SHA-256 refresh-token storage
auth_sessions
refresh rotation
server-side revoke
idempotent logout
inactive-user guard
development create-user CLI
```

Endpoints:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

Migration:

```text
20260925_0009_auth_sessions
```

Backend:

```text
0.19.0
```

Документ:

[Authentication Token Protocol v1](auth-token-v1.md)

Verification завершено.


## Verification Операції 2

Локально підтверджено:

```text
Argon2id password hash у PostgreSQL                  ✅
raw password у PostgreSQL відсутній                  ✅
Login → access + refresh token                       ✅
access TTL = 900 s                                   ✅
refresh TTL = 30 days                                ✅
у БД зберігається SHA-256(refresh_token), 64 hex     ✅
refresh rotation                                     ✅
старий refresh token після rotation → 401            ✅
absolute refresh expiry не продовжується             ✅
logout → revoked_at                                  ✅
refresh після logout → 401                           ✅
wrong password → generic invalid-credentials error   ✅
unknown email → та сама generic error                ✅
```

Операція 2 — Password Security + Token Auth завершена.


## Операція 3 — Current User / Session Context

Реалізовано:

```text
Bearer access token dependency
JWT signature / issuer / audience / expiry validation
sub → user_id
sid → auth_session_id
server-side auth session lookup
revoked session guard
expired session guard
inactive User guard
GET /api/v1/auth/me
active organization memberships у /me
```

Backend:

```text
0.20.0
```

Migration не потрібна.

Документ:

[Current User / Session Context v1](current-user-context-v1.md)

Поточна задача — локально перевірити valid access token, missing token та revoked-session behavior.


### Verification Операції 3

Локально підтверджено:

```text
GET /api/v1/auth/me з valid access JWT              ✅
Current User визначається правильно                  ✅
auth_session_id читається з JWT/session context      ✅
memberships повертаються як active membership list    ✅
logout → server-side session revoked                  ✅
той самий access JWT після logout → 401               ✅
```

Фінальну перевірку завершено: `/auth/me` без Bearer token → 401 ✅.


Операція 3 — Current User / Session Context завершена.


## Операція 4 — RBAC + Multi-tenant Guards

### Операція 4.1 — Permission Matrix + Existing API Guards

Реалізовано:

```text
централізований Permission enum                         ✅
role → permission matrix                                ✅
AccessControl                                           ✅
active membership lookup                                ✅
tenant-scoped Organization listing                      ✅
Organization guards                                     ✅
Site guards                                             ✅
Device + availability guards                            ✅
Telemetry + state guards                                ✅
Command read / execute guards                           ✅
Capability read / manage guards                         ✅
foreign tenant anti-enumeration через generic 404       ✅
superadmin platform bypass                              ✅
service_admin лише explicit tenant memberships          ✅
```

Backend:

```text
0.21.0
```

Migration не потрібна.

Документ:

[RBAC + Multi-tenant Guards v1](rbac-multitenant-guards-v1.md)

Поточна задача — локальна behavioral verification ролі `operator`, після чого tenant-isolation test з окремою Organization.


### Verification Операції 4.1 — початок

Локально підтверджено:

```text
backend 0.21.0 запускається стабільно                  ✅
Organization list без membership → []                 ✅
operator membership успішно призначено                ✅
Organization list після membership → TechBaza Test Farm ✅
```

Додатково локально підтверджено:

```text
/auth/me одразу бачить role=operator без перевидачі JWT   ✅
operator → device.read                                    ✅
operator → site.create                                    ✅ deny / 403
```

Це підтверджує live role propagation з PostgreSQL та централізовану permission matrix.

Наступна перевірка — tenant isolation: User з membership у Organization A не повинен бачити Organization B, Site B або Device B.


### Verification tenant isolation — проміжний результат

Локально підтверджено:

```text
Organization B створена в PostgreSQL                         ✅
Organization B відсутня у tenant-scoped списку User A        ✅
прямий GET чужої Organization B → generic 404                ✅
прямий GET чужого Device B → generic 404                     ✅*
```

`* DB-перевірка підтвердила, що Organization B, Site B та Device B реально існують. Отже generic 404 на API є саме authorization-hiding, а не звичайним not-found.


### Tenant isolation — підтверджено

DB join підтвердив існування повного чужого tenant tree:

```text
Organization B = Tenant B Test
Site B         = Tenant B Site
Device B       = TB-TENANT-B-001
```

При цьому User A:

```text
не бачить Organization B у list endpoint                 ✅
GET Organization B напряму → generic 404                  ✅
GET Device B напряму → generic 404                        ✅
```

tenant isolation для Organization B / Site B / Device B доведено.


### Verification viewer role — проміжний результат

Локально підтверджено:

```text
membership role змінено на viewer                       ✅
/auth/me одразу повертає role=viewer                    ✅
viewer → device.read                                    ✅
```

Залишилось підтвердити, що `viewer` не має `command.execute` і отримує 403.


### Verification viewer role — завершено

Локально підтверджено:

```text
viewer → device.read                                      ✅
viewer → command.execute                                  ✅ deny / 403
```

Роль `viewer` підтверджена: read-only доступ працює, керуючі команди блокуються permission layer.


### Verification admin role — завершено

Локально підтверджено:

```text
membership role змінено на admin                         ✅
/auth/me повертає role=admin                             ✅
admin → site.create                                      ✅
admin → command.execute                                  ✅
command створена зі status=queued                        ✅
```

Це підтверджує, що RBAC не лише блокує заборонені дії, а й коректно пропускає дозволені write operations.


### Операція 4.1 — завершено

Behavioral verification підтвердив:

```text
operator read/execute matrix                              ✅
viewer read-only matrix                                   ✅
admin write permissions                                   ✅
tenant isolation A/B                                      ✅
foreign resource anti-enumeration                         ✅
live role propagation без перевидачі JWT                  ✅
```

### Операція 4.2 — Membership Management API ← у роботі

Реалізовано:

```text
GET organization memberships                             ✅
POST membership                                           ✅
PATCH membership role / active state                      ✅
owner privilege-escalation protection                     ✅
last-active-owner invariant                               ✅
soft revoke через is_active=false                         ✅
```

Backend:

```text
0.22.0
```

Migration не потрібна.

Документ:

[Membership Management v1](membership-management-v1.md)

Поточна задача — локальна verification admin membership-management flow.

Перший крок підтверджено:

```text
backend 0.22.0                                          ✅
admin → GET organization memberships                   ✅
відповідь містить user/email/display_name/role/active  ✅
```



### Membership Management verification — test User created

Локально створено другого User для API verification:

```text
email         = viewer-test@techbaza.dev
user_id       = 8fa4670a-f551-4faa-ab9a-273936f2ff22
platform_role = user
```

Membership для цього User ще не створено. Наступний крок — додати його до TechBaza Test Farm через POST memberships API з role=viewer.


### Membership Management verification — POST membership

Локально підтверджено:

```text
viewer-test@techbaza.dev додано через POST memberships   ✅
membership id = 5dfdf2a4-4dc1-44da-a74a-1bb3e5c84796
role = viewer                                            ✅
is_active = true                                         ✅
membership створено без прямого SQL                      ✅
```

Наступний крок — GET memberships і PATCH viewer → operator через API.


### Membership Management verification — GET + PATCH

Локально підтверджено:

```text
GET memberships повертає 2 memberships                    ✅
stage6-admin@techbaza.dev → admin                          ✅
viewer-test@techbaza.dev → viewer                          ✅
PATCH viewer → operator через Membership API               ✅
оновлений role=operator повернуто у response                ✅
is_active залишився true                                   ✅
```

Керування tenant-role через API працює без прямого SQL.
Наступна перевірка — protection від privilege escalation: admin не повинен мати можливості призначити role=owner.


### Membership Management verification — owner protection

Локально підтверджено:

```text
admin → PATCH membership role=owner                         ✅ deny / 403
response: "Лише owner може керувати роллю owner"            ✅
privilege escalation через admin заблоковано                ✅
```

Наступна перевірка — operator не повинен мати membership.read / membership.manage.


### Membership Management verification — operator access denied

Локально підтверджено:

```text
viewer-test@techbaza.dev → role=operator                  ✅
/auth/me повертає operator                               ✅
operator → GET organization memberships                  ✅ deny / 403
response: "Недостатньо прав для цієї дії"                 ✅
```

Отже operator не має `membership.read` та не отримує доступ до адміністративного контуру Organization.


### Membership Management verification — owner bootstrap

Локально підтверджено:

```text
stage6-admin@techbaza.dev → role=owner                     ✅
/auth/me без перевидачі JWT одразу повертає owner          ✅
```

Поточний owner membership:
```text
membership_id = 33333333-3333-4333-8333-333333333333
user_id       = 66e74c79-0b0b-44ea-9fe1-8ee3f2d0bc3d
```

Наступна перевірка — owner може призначити другого owner, а останнього active owner неможливо понизити або деактивувати.


### Membership Management verification — last-owner invariant

Локально підтверджено:

```text
owner → призначити другого owner                         ✅
другий owner → повернути в operator                      ✅
останній active owner → downgrade в admin                ✅ deny / 409
response: "Не можна прибрати останнього активного owner організації" ✅
```

Це підтверджує owner-protection та last-active-owner invariant.

### Операція 4.2 — завершено

Повна behavioral verification:

```text
admin → GET memberships                                  ✅
admin → POST membership                                  ✅
admin → PATCH viewer → operator                          ✅
admin → assign owner                                     ✅ deny / 403
operator → GET memberships                               ✅ deny / 403
owner → assign другого owner                             ✅
owner → downgrade другого owner                          ✅
останній active owner → downgrade/deactivate             ✅ deny / 409
soft revoke model через is_active                        ✅
```

Операція 4 — RBAC + Multi-tenant Guards завершена.

Наступна операція Етапу 6:

```text
Операція 5 — Command Actor Audit
```


## Операція 5 — Command Actor Audit

Реалізовано foundation:

```text
migration 20260925_0010                                 ✅
actor_user_id                                           ✅
actor_auth_session_id                                   ✅
actor_organization_id                                   ✅
actor_platform_role snapshot                            ✅
actor_organization_role snapshot                        ✅
actor_email snapshot                                    ✅
actor_display_name snapshot                             ✅
actor-aware request_id idempotency                      ✅
Device access context повертає tenant role              ✅
command GET/POST schemas експонують audit metadata      ✅
```

Backend:

```text
0.23.0
```

Документ:

[Command Actor Audit v1](command-actor-audit-v1.md)

Поля actor є immutable snapshot на момент створення command. Legacy commands,
створені до migration 0010, можуть мати `null` actor metadata.

Поточна задача — локальна migration + behavioral verification.
