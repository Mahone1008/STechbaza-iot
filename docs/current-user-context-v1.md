# Current User / Session Context v1

## Мета

Операція 3 Етапу 6 переводить access JWT з просто виданого token у реальний authenticated HTTP context.

Backend тепер може відповісти на питання:

```text
Хто виконує цей request?
Яка server-side session підтверджує його token?
Чи не revoked ця session?
Чи активний сам User?
У яких Organization User має активне membership?
```

## Endpoint

```text
GET /api/v1/auth/me
```

Потрібен header:

```text
Authorization: Bearer <access_token>
```

## Перевірка access token

Порядок:

```text
Bearer header
   ↓
JWT signature
   ↓
issuer + audience
   ↓
exp / nbf / iat
   ↓
type == access
   ↓
sub → user_id
sid → auth_session_id
   ↓
server-side auth_sessions lookup
   ↓
session належить User
   ↓
session не revoked
   ↓
session не expired
   ↓
User існує та active
   ↓
CurrentUserContext
```

## Чому перевіряється server-side session

Сам JWT може бути математично валідним ще кілька хвилин після logout.

Тому TechBaza не покладається лише на JWT signature.

```text
access JWT valid
       +
auth_session.revoked_at is NULL
       +
auth_session.expires_at > now
       +
User.is_active = true
       =
authenticated request
```

Це означає, що logout може заблокувати подальше використання access token одразу, не чекаючи його `exp`.

## /auth/me response

Response не містить password hash або refresh token.

Приклад:

```json
{
  "id": "user-uuid",
  "email": "user@example.com",
  "display_name": "User",
  "platform_role": "user",
  "is_active": true,
  "auth_session_id": "session-uuid",
  "auth_session_expires_at": "2026-10-25T...",
  "memberships": [
    {
      "organization_id": "organization-uuid",
      "role": "operator"
    }
  ]
}
```

Повертаються лише active organization memberships.

## HTTP semantics

```text
немає Bearer token              → 401
JWT invalid / expired            → 401
session unknown                  → 401
session revoked                  → 401
session expired                  → 401
User unknown                     → 401
User inactive                    → 403
valid User + valid session       → 200
```

## Межа Операції 3

На цій операції authenticated context підключений до `/auth/me`.

Повний захист Organization / Site / Device / Telemetry / Commands буде накладений в Операції 4 — RBAC + Multi-tenant Guards.
