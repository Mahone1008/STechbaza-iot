# Frontend v1 — поетапний план KERUMO

Дата: 27.09.2026. База: backend **0.38.0**, Етап H завершено 5/5.

**Статус: прийнято 4 із 24 операцій. Етап 9 завершено 4/4.
Операцію 10.1 реалізовано й автоматично перевірено; очікується локальне
користувацьке приймання.**

Frontend поділено на Етапи 9–14. Кожен етап має чотири операції. Наступна
операція не закривається автоматично після реалізації: потрібні CI та локальне
користувацьке приймання.

## 1. Результат frontend v1

Користувач входить у кабінет, обирає організацію й об’єкт, бачить доступні
пристрої та лише призначені їм modules/capabilities. Панель показує якість і
давність даних, графіки, дозволені команди з реальним lifecycle, аварії,
події та персональні notifications. Інтерфейс працює на desktop і mobile з
чинним demo API.

За межами першого release: billing, B2B invitation/QR claim, mass provisioning,
повний service portal, alarm rule editor, camera/video, OTA, native app і
локальна offline queue для command writes.

## 2. Технічна основа

- React + Next.js + TypeScript strict;
- FastAPI залишається єдиним backend і джерелом auth/RBAC/business rules;
- OpenAPI snapshot + generated TypeScript contract;
- shared API adapter із timeout/cancel/normalized errors;
- TanStack Query із user/session/tenant/device scoped keys;
- access token лише в memory, refresh token лише в HttpOnly cookie;
- bounded polling тільки видимих даних;
- Vitest component/unit tests і Playwright Chromium smoke/full E2E;
- UI `http://127.0.0.1:3000`, demo API `http://127.0.0.1:8001`.

## 3. Карта екранів і API

| Екран | Джерело | Головне правило |
|---|---|---|
| Login/session | browser login/refresh/logout, `/auth/me` | один session coordinator; refresh cookie не читає JS |
| Організації/об’єкти | organizations, access, sites | URL сам по собі не дає доступ |
| Пристрої | devices + bounded availability | не запитувати overview всього парку |
| Device dashboard | overview | modules/readings/state/permissions визначає backend |
| Графіки | telemetry series | missing — gap, zero — значення |
| Команди | create/list/get command | один request_id на intent; ACK ≠ Result |
| Аварії/події | alarms/transitions/events | acknowledge ≠ resolved |
| Notifications | stream/unread/read | read персональне й не замінює acknowledge |

## 4. Етап 9 — структура інтерфейсу та основа

**Статус Етапу 9: завершено 4/4 27.09.2026.**

| Операція | Результат | Статус |
|---|---|---|
| 9.1 — Сценарії та макети | light industrial SaaS visual direction, page map, roles, desktop/mobile, all UI states | **Закрито 27.09.2026** |
| 9.2 — Каркас і компоненти | Next.js/TS strict, tokens, navigation shell, primitives, lockfile, clean build | **Закрито 27.09.2026** |
| 9.3 — API adapter і контракти | OpenAPI types, base URL, timeout/cancel, error mapping, query keys/cache lifecycle | **Закрито 27.09.2026** |
| 9.4 — Відтворюваний baseline | component/unit tests, Chromium smoke, frontend CI, clean setup docs, schema update policy | **Закрито 27.09.2026** |

Досьє:

- [9.1 — UX-сценарії та макети](stage-9-op1-ux-and-mockups.md)
- [9.2 — frontend foundation](stage-9-op2-frontend-foundation.md)
- [9.3 — API adapter і контракти](stage-9-op3-api-adapter.md)
- [9.4 — відтворюваний frontend baseline](stage-9-op4-frontend-baseline.md)
- [Досьє V3.5 — Етап 9 — Frontend Foundation KERUMO](dossier-v3.5-stage-9-frontend-foundation.md)

## 5. Етап 10 — вхід, сесія та права

| Операція | Результат | Статус |
|---|---|---|
| 10.1 — Login | email/password, CSRF, credentials include, HttpOnly cookie, memory-only access, 401/403/422/429/network UI | **Реалізовано; CI PASS; локальне приймання очікується** |
| 10.2 — Відновлення session | refresh cookie, memory access token, single-flight і tab coordination | Заплановано |
| 10.3 — Permissions/guards | `/auth/me`, organization access, cache isolation, route guards | Заплановано |
| 10.4 — Logout і збої | coordinated revoke, cancel pending requests, no session resurrection | Заплановано |

Досьє поточної операції:

- [10.1 — справжній browser login KERUMO](stage-10-op1-browser-login.md)

Автоматичний повтор write/login mutation після 401 або network uncertainty не
допускається. 10.1 не закривається до локального Windows PASS користувача.

## 6. Етап 11 — організації, пристрої та модульна панель

| Операція | Результат |
|---|---|
| 11.1 — Організації й об’єкти | lists, breadcrumbs, deep links, pagination, valid context restore |
| 11.2 — Список пристроїв | paginated rows, bounded presence calls, cancel old page requests |
| 11.3 — Registry віджетів | UI із modules/channels; units, numeric/state, unsupported fallback |
| 11.4 — Якість/конфігурація | fresh/stale/missing/invalid, session change, enable/disable, revoke |

Summary endpoint додається лише після виміряної потреби, не наперед.

## 7. Етап 12 — графіки та команди

| Операція | Результат |
|---|---|
| 12.1 — Історія | metric, unit, period, bucket, min/max/average/count, gaps, timezone |
| 12.2 — Оновлення | one polling policy, backoff, cancel/dedup, hidden-tab pause, budget |
| 12.3 — Start/Stop/frequency | allowed_commands, validation, confirmation, one request_id |
| 12.4 — Lifecycle/journal | queued→published→ack→result, TTL, audit, stable pagination |

Start/frequency не накопичуються локально для відправлення після reconnect.

## 8. Етап 13 — аварії, події та notifications

| Операція | Результат |
|---|---|
| 13.1 — Аварії | filters, severity, active/resolved, incident detail, transitions |
| 13.2 — Acknowledge | permission, pending/error, idempotency, concurrent resolution |
| 13.3 — In-app feed | organization stream, unread count, personal read, tenant isolation |
| 13.4 — Наскрізний інцидент | MQTT → rule → alarm → notification → ack → recovery |

Глобальний alarm dashboard не симулюється fan-out запитами без bounded API.

## 9. Етап 14 — якість і приймання frontend v1

| Операція | Результат |
|---|---|
| 14.1 — UX/accessibility | mobile/tablet/desktop, keyboard, focus, contrast, zoom, states |
| 14.2 — Browser regression | Playwright full path, roles, two tenants, two tabs |
| 14.3 — Security/performance | cache isolation, races, escaping, CSP, bundle/requests/heap/latency |
| 14.4 — Release/dossier | production build, clean run, real demo E2E, revision evidence |

## 10. Незмінні правила

1. Module assignment не дорівнює physical sensor instance.
2. Online, fresh telemetry, HTTP success, MQTT ACK і physical Result — різні стани.
3. Backend завжди повторно перевіряє permissions.
4. Logout/context switch cancel-ить requests і видаляє scoped cache.
5. Missing не стає нулем, графік не з’єднує gaps.
6. GET retry bounded; write/login retry має окрему policy.
7. Mock data не маскують збій live API.
8. Frontend CI не замінює backend suite.
9. Access token не persist-иться; refresh token не читається JavaScript.
10. Route guards не вважаються готовими до операції 10.3.

**Поточна точка: локальне приймання 10.1 — реальний browser login,
CSRF, HttpOnly cookie, memory-only access token і auth error states.**
