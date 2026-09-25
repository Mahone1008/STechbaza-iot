# Етап 6 — Users, Authentication & RBAC

**Статус:** у роботі  
**Backend:** 0.18.0+

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
Операція 2 — Password Security + Token Auth         ← у роботі
Операція 3 — Current User / Session Context
Операція 4 — RBAC + Multi-tenant Guards
Операція 5 — Command Actor Audit
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
