# Command Actor Audit v1

## Мета

Кожна нова remote command повинна мати незмінний audit snapshot того,
хто її створив і в якому authorization context це сталося.

Це дозволяє відповісти на питання:

```text
хто виконав дію?
з якої auth session?
у якій Organization?
з якою platform role?
з якою organization role?
який account/email/display name був на момент дії?
```

## Migration

```text
20260925_0010_command_actor_audit
```

## Backend

```text
0.23.0
```

## Поля device_commands

До `device_commands` додано:

```text
actor_user_id
actor_auth_session_id
actor_organization_id
actor_platform_role
actor_organization_role
actor_email
actor_display_name
```

Поля nullable, тому що історичні commands, створені до migration 0010,
не мають достовірного actor attribution.

## Чому actor metadata — snapshot

Role, display name або email User можуть змінитися пізніше.

Audit має показувати context саме на момент створення command, тому
значення копіюються в command record і не обчислюються заднім числом.

Наприклад:

```text
сьогодні User = owner
через місяць User = viewer

стара command все одно повинна показувати:
actor_organization_role = owner
```

## Чому немає FK для actor_* id

Це свідоме рішення для audit durability.

```text
User/AuthSession видалено або очищено
        ↓
історичний command record залишається
        ↓
actor UUID + email + display name snapshot не втрачаються
```

DeviceCommand як і раніше належить Device і живе в його lifecycle.

## Authorization flow

```text
Bearer JWT
   ↓
CurrentUserContext
   ↓
AccessControl.require_device_context()
   ↓
permission command.execute
   ↓
organization_id + organization_role
   ↓
CommandActorSnapshot
   ↓
DeviceCommand
```

Для platform superadmin `actor_organization_role` може бути `null`,
тому що superadmin проходить platform bypass без tenant membership.

## Idempotency

`request_id` залишається глобальним idempotency key.

Повтор того самого request допускається, якщо збігаються:

```text
actor_user_id
device_id
command_type
payload
ttl_seconds
```

Auth session та role snapshot не входять у matching, тому той самий User
може безпечно повторити HTTP request після refresh/re-auth, якщо він усе
ще має permission.

Інший User з тим самим `request_id` отримує conflict.

## API

Існуючі command endpoints тепер повертають actor metadata:

```text
POST /api/v1/devices/{device_id}/commands
GET  /api/v1/devices/{device_id}/commands
GET  /api/v1/commands/{command_id}
```

## Verification plan

Потрібно локально підтвердити:

```text
migration 0010 applied                                  ✅ expected
health version = 0.23.0                                 ✅ expected
owner/operator command → actor_user_id                  ✅ expected
actor_auth_session_id = current /auth/me session        ✅ expected
actor_organization_id = target tenant                   ✅ expected
actor_platform_role snapshot                            ✅ expected
actor_organization_role snapshot                        ✅ expected
actor email/display name snapshot                       ✅ expected
role change після command не змінює старий audit        ✅ expected
інший User + reused request_id → 409                    ✅ expected
```
