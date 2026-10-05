# Membership Management v1

## Мета

Операція 4.2 додає керований API для ролей користувачів усередині Organization.

До цього membership змінювався вручну через PostgreSQL. Тепер це переходить у business API.

## Endpoints

```text
GET   /api/v1/organizations/{organization_id}/memberships
POST  /api/v1/organizations/{organization_id}/memberships
PATCH /api/v1/organizations/{organization_id}/memberships/{membership_id}
```

Hard delete навмисно не використовується. Для відкликання доступу membership переводиться в:

```text
is_active = false
```

Це краще для подальшого audit trail.

## Permission model

```text
owner  → membership.read + membership.manage
admin  → membership.read + membership.manage
operator → deny
viewer   → deny
service  → deny
```

## Owner protection

Починаючи зі schema 0022, create/update/read також підтримують `site_ids`
і `expires_at`. `site_ids: null` означає всю організацію; непорожній список
містить 1–100 UUID об'єктів саме цієї організації. `expires_at: null` — без
строку; нове значення має бути timezone-aware і в майбутньому. PATCH без
поля зберігає попереднє значення, явний null знімає відповідне обмеження.

Expired membership не дає доступу. Membership з обмеженням об'єктів не
може створювати нові Site або читати/керувати memberships навіть із роллю
admin. Scope перевіряється для Site/Device і фільтрує доступні списки.
Owner завжди має постійний доступ до всієї організації: scope/expiry
для нього відхиляються з 422. MFA policy привілейованого доступу описано
в [account contract](buyer-onboarding-v1.md).

Щоб admin не міг підвищити себе до owner або прибрати owner:

```text
admin → assign owner                 403
admin → modify owner                 403
owner → manage owner                 allowed
superadmin → owner bypass            allowed
```

Додатково діє invariant:

```text
Organization повинна мати хоча б одного active owner.
```

Тому демоут або деактивація останнього active owner повертає:

```text
409 Conflict
```

## Existing membership

Пара:

```text
organization_id + user_id
```

унікальна.

Якщо membership уже існує, повторний POST повертає 409. Реактивація виконується PATCH через `is_active=true`.

## Membership response

API повертає:

```text
membership id
organization id
user id
user email
user display name
role
is_active
site_ids
expires_at
created_at
updated_at
```

Password hash, token або auth session data не повертаються.

## Початковий checklist перевірки

Ці сценарії були заплановані для першого приймання; його результат наведено нижче:

```text
admin → list memberships                    200
admin → add viewer                          201
admin → viewer → operator                   200
admin → assign owner                        403
operator/viewer → membership list           403
```

Owner/last-owner invariant перевіряється окремо.


## Verification result

Локально підтверджено:

```text
admin → list memberships                    200 ✅
admin → add viewer                          201 ✅
admin → viewer → operator                   200 ✅
admin → assign owner                        403 ✅
operator → membership list                  403 ✅
owner → assign другого owner                200 ✅
owner → downgrade другого owner             200 ✅
останній active owner → downgrade           409 ✅
```

Membership Management v1 behavioral verification завершено.
