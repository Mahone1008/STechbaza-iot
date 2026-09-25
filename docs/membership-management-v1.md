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
created_at
updated_at
```

Password hash, token або auth session data не повертаються.

## Наступна verification

Потрібно локально довести:

```text
admin → list memberships                    200
admin → add viewer                          201
admin → viewer → operator                   200
admin → assign owner                        403
operator/viewer → membership list           403
```

Owner/last-owner invariant перевіряється окремо.
