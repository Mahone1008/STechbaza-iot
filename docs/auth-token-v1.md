# Authentication Token Protocol v1

## Мета

Операція 2 Етапу 6 додає password security та token authentication.

## Password storage

Пароль ніколи не зберігається у plain text.

Використовується:

```text
Argon2id
```

У таблиці `users` зберігається лише:

```text
password_hash
```

Мінімальна довжина нового password:

```text
12 символів
```

Максимальна:

```text
128 символів
```

## Login

Endpoint:

```text
POST /api/v1/auth/login
```

Request:

```json
{
  "email": "user@example.com",
  "password": "..."
}
```

Response:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_token": "...",
  "refresh_expires_in": 2592000
}
```

## Access token

Access token — signed JWT.

Default lifetime:

```text
15 хвилин
```

Claims:

```text
sub  → user_id
sid  → auth_session_id
type → access
jti  → unique token id
iss
aud
iat
nbf
exp
```

Role навмисно не є джерелом істини всередині JWT. На authorization layer роль та membership будуть читатися з server-side state, щоб зміна прав не чекала завершення довгого token lifetime.

## Refresh token

Refresh token є opaque random secret.

Default lifetime:

```text
30 днів
```

У PostgreSQL raw refresh token не зберігається.

Зберігається лише:

```text
SHA-256(refresh_token)
```

Таблиця:

```text
auth_sessions
```

Поля:

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

## Refresh rotation

Endpoint:

```text
POST /api/v1/auth/refresh
```

Кожний успішний refresh:

```text
old refresh token
      ↓
lock auth_session row
      ↓
перевірка revoked / expiry / active user
      ↓
new refresh token
      ↓
hash замінюється в PostgreSQL
      ↓
old token більше не працює
```

Absolute expiry session не подовжується при кожному refresh.

## Logout

Endpoint:

```text
POST /api/v1/auth/logout
```

Logout ставить:

```text
revoked_at != null
```

Операція idempotent: unknown/repeated token не розкриває session state.

Короткоживучий access JWT може існувати до свого `exp`. На наступній операції Current User Context може додатково перевіряти server-side session state.

## User creation

Public self-registration на цьому етапі навмисно не відкривається.

Для development/bootstrap використовується CLI:

```powershell
docker compose exec backend python -m app.tools.create_user --email admin@techbaza.local --display-name "TechBaza Admin" --platform-role user
```

Password вводиться через hidden prompt, а не command-line argument, щоб не залишати його у shell history.

## Security properties

```text
Argon2id password hashing                          ✅
generic invalid-login response                    ✅
dummy password verify для unknown email           ✅
short-lived signed access JWT                     ✅
opaque cryptographically-random refresh token      ✅
refresh token hash only in DB                     ✅
refresh rotation                                  ✅
row lock під час refresh                          ✅
server-side revocation                            ✅
idempotent logout                                 ✅
inactive-user guard                               ✅
```

## Environment

```text
AUTH_ACCESS_TOKEN_SECRET
AUTH_ACCESS_TOKEN_TTL_SECONDS
AUTH_REFRESH_TOKEN_TTL_SECONDS
AUTH_TOKEN_ISSUER
AUTH_TOKEN_AUDIENCE
```

Local default secret дозволений лише для development.

Перед production deployment secret має бути замінений випадковим значенням та зберігатися поза Git.
