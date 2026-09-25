# Security End-to-End Test v1

## Мета

Перевірити весь security flow TechBaza IoT одним послідовним сценарієм:

```text
login
  ↓
auth session
  ↓
tenant membership
  ↓
RBAC
  ↓
device access
  ↓
command execute
  ↓
actor audit
  ↓
live role change
  ↓
permission update
  ↓
logout / session revoke
  ↓
old access token deny
```

## Test actors

```text
viewer-test@techbaza.dev  → owner
stage6-admin@techbaza.dev → admin
```

## Target tenant

```text
organization_id = 2b60bce4-0d34-43f7-a5ec-2e674e64684f
device_id       = 41a7a0ee-72df-4655-8572-b823ec320195
device_uid      = TB-ESP32-001
```

## Acceptance criteria

```text
owner login succeeds
/auth/me exposes owner membership
owner can read target Device
owner can execute command
command stores immutable actor snapshot
live role change changes authorization without issuing new JWT
logout revokes auth session
old JWT is rejected after logout
foreign tenant remains hidden
```

Поточний статус: verification in progress.
