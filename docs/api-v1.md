# HTTP API v1

Прикладні маршрути мають префікс `/api/v1`. [Генерований перелік усіх paths](generated-code-reference.md#http-api)
отримується з committed OpenAPI; `/openapi.json` працюючого backend є машинним
контрактом DTO, query limits та responses. CI перевіряє zero diff зі schema TypeScript.

## Групи та доступ

У 0.50.0 public customer API й private staff API запускаються окремо. Production `/openapi.json` описує лише відповідний застосунок; committed SDK snapshot об’єднує контракт клієнта та `/staff/*` для генерації TypeScript. `/staff/*` працюють тільки у VPN-службовому API з MFA; users, audit, monitoring та адміністративні mutation wrappers потребують superadmin. [Приватний контракт і перевірки](staff-console-v1.md).

| Група | Призначення | Доступ |
|---|---|---|
| `/auth/browser/*` | Browser login/refresh/logout | Exact Origin, CSRF header, HttpOnly cookie; login credentials |
| `/auth/login`, `/auth/refresh`, `/auth/logout` | JSON flow для CLI | Credentials/refresh secret, спільний rate limiter |
| `/auth/me` | User/session/memberships | Bearer JWT та активна server-side session |
| `/auth/recover` | Відновлення за recovery key | Exact Origin/CSRF, throttle; вхід не потрібний |
| `/auth/security/*`, `/auth/security`, `/auth/sessions*` | Постійний пароль/TOTP/recovery/власні сесії | Bearer; зміни ключів із password/OTP proof |
| `/staff/*` | Користувачі, ролі, scope, сесії, audit і діагностика | Private API, platform role + MFA, sensitive changes: password/OTP/reason |
| `/factory/controllers*` | Заводський реєстр, постачання, аудит | `superadmin` та MFA-verified session завжди |
| `/connect/*` | Claim покупця, об'єкти й вибір обладнання | Bearer, заводський пароль, permanent password/TOTP при першій активації, tenant/scope guards |
| `/bootstrap/{id}/contact` | Час контакту та версія контролера | Окремий bootstrap Bearer secret, throttle; не user JWT |
| `/organizations`, `/organizations/{id}/access` | Доступні клієнти й permissions | Tenant membership; superadmin bypass |
| Sites/devices | Каталог установок та контролерів | Відповідні read/create permissions |
| Capabilities | Каталог та assignments конкретного Device | Read/manage; catalog create — platform service_admin/superadmin |
| Telemetry/state/availability/overview/series | Показники, якість, присутність та історія | Tenant scope і відповідні permissions/capabilities |
| Commands | Створення, поточний lifecycle та журнал | command.execute/read, capability; profile/dispatch guards |
| Equipment/profiles/configurations/manifest | Паспорт, каталог і desired/applied binding | Device read або capability.manage; каталог — активний вхід |
| Schedules/preview/runs | Календарні правила, preview і журнал запусків | command.read/execute та tenant guards |
| Events/alarms/transitions/acknowledge | Історія інцидентів та actor audit | event.read, alarm.read/acknowledge |
| Notifications/count/read | Персональна стрічка та прочитання | notification.read та поточний tenant scope |

Прямий `POST /organizations` дозволяється superadmin. Buyer claim може
створити персональну організацію й owner як частину захищеної транзакції;
[точний onboarding flow](buyer-onboarding-v1.md). Platform service_admin не має
автоматичного доступу до всіх клієнтів. [Точна матриця](rbac-multitenant-guards-v1.md).
Чужий tenant і відсутній ресурс повертають однаковий 404; UI guard не замінює API guard.

## Browser flow

Frontend отримує access у memory через browser login/refresh, потім передає
`Authorization: Bearer <access>`. Refresh cookie сама по собі не авторизує
звичайні resource endpoints. На F5 frontend відновлює session; logout
відкликає її на сервері. [Cookie/CORS/CSRF та помилки](browser-auth-v1.md).

## Команди

`POST /api/v1/devices/{device_id}/commands` приймає `request_id`,
`command_type`, `payload`, `ttl_seconds` і опціональний `supersedes_request_id`
для Stop. Типи: `vfd.start`, `vfd.stop`, `vfd.frequency.set`, `vfd.program.start`.
Програма використовує versioned payload із масивом етапів; для неї потрібні
`vfd.program` і `vfd.control`. [Межі, допуск і результати](control-programs-v1.md).
`vfd.schedule.start` створює scheduler за збереженим правилом; прямий
користувацький POST цієї команди не дозволено. [Календарний API](control-schedules-v1.md).
При тотожному повторі того самого автора повертається та сама команда:
201 для нової, 200 для повтору; конфлікт намірів — 409.

API зберігає команду до MQTT dispatch. Новий POST/ACK не доводить запуск двигуна.
TTL 5–300 с (типово 30) обмежує перше прийняття; тривалість RUN він не задає.
Діапазон frequency визначає валідований профіль установки, крім загальної
API-межі 0..100 Гц. Порядок Stop, повторна перевірка прав, пізні відповіді,
sequence та `result_unknown`: [command safety](command-safety-v2.md).
Managed equipment binding додає [envelope v3](equipment-foundation-v1.md).

## Діагностика й помилки

`/health` публічний та показує liveness/version. DB/MQTT/reliability/system
діагностика потребує Bearer superadmin; [поведінка](backend-development.md).
Помилки доступу зазвичай мають `{"detail":"…"}`, 422 — validation detail;
єдиного універсального machine error envelope ще немає.
401/403/404/409/422 не можна трактувати як успішне виконання; 429 має Retry-After.

[Контракт frontend](frontend-api-contract-v1.md) пояснює projection, pagination,
свіжість даних та доступні дії. Актуальні обмеження — у [статусі](project-status.md).
