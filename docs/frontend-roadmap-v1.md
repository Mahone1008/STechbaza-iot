# Frontend v1 — поетапний план KERUMO

Дата: 27.09.2026. База: backend **0.38.0**, Етап H завершено 5/5.

**Статус: прийнято 10 із 24 операцій. Етап 9 завершено 4/4.
Етап 10 завершено 4/4 після CI та локального Windows-приймання.
11.1 і 11.2 прийнято 28.09.2026 після Windows PASS і ручного підтвердження.
Поточна точка — Етап 12 реалізовано 4/4, загальне досьє V3.5 складено;
перевірки та залишок локального приймання наведено нижче.
11.3 + 11.4 мають Windows PASS із залишком ручних сценаріїв.**

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
- browser session recovery із single-flight і cross-tab coordination;
- verified `/auth/me`, organization access і runtime permission registry;
- workspace route guards без tenant-data flash;
- permission-aware navigation і critical controls;
- server-side browser logout, cross-tab revoke і no session resurrection;
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

**Статус Етапу 10: завершено 4/4 27.09.2026.**

| Операція | Результат | Статус |
|---|---|---|
| 10.1 — Login | email/password, CSRF, credentials include, HttpOnly cookie, memory-only access, 401/403/422/429/network UI | **Закрито 27.09.2026** |
| 10.2 — Відновлення session | F5 recovery, proactive refresh, memory access token, single-flight і cross-tab coordination | **Закрито 27.09.2026; CI і Windows PASS** |
| 10.3 — Permissions/guards | `/auth/me`, visible organizations, organization access, session cache isolation, safe returnTo, permission-aware routes/navigation/controls | **Закрито 27.09.2026; CI і Windows PASS** |
| 10.4 — Logout і збої | server-side revoke, cross-tab cleanup, cancel pending requests, Retry-After і no session resurrection | **Закрито 27.09.2026; CI і Windows PASS** |

Досьє:

- [10.1 — справжній browser login KERUMO](stage-10-op1-browser-login.md)
- [10.2 — відновлення browser session KERUMO](stage-10-op2-session-recovery.md)
- [10.3 — профіль, permissions і route guards KERUMO](stage-10-op3-permissions-and-guards.md)
- [10.4 — logout, revoke і захист від session resurrection](stage-10-op4-logout-and-failures.md)
- [Досьє V3.5 — Етап 10 — Browser Authentication, Session Recovery, RBAC & Logout KERUMO](dossier-v3.5-stage-10-browser-auth-session-rbac.md)

Access token не persist-иться. Refresh token не читається JavaScript.
Temporary network failure не прирівнюється до logout; write requests не
повторюються автоматично після невизначеного результату. Workspace content
не рендериться до підтвердження session, `/auth/me`, organization і access.
Frontend guard не замінює backend authorization.

Локальне приймання 10.3 підтвердило:

- anonymous `/devices` → `/login?returnTo=%2Fdevices` без tenant-data flash;
- owner context із real backend organization/profile/role;
- viewer context із disabled Start/Stop/frequency/settings;
- explicit warning про відсутній `command.execute`;
- 22 unit, 19 mocked Chromium і 6 real Chromium tests — PASS.

Автоматичний gate 10.4 підтвердив:

- `POST /auth/browser/logout` із CSRF і HttpOnly cookie;
- revoke поточної server-side session;
- старий access token → `401` після logout;
- одна вкладка очищує всі same-origin вкладки;
- F5 і новий protected route не відновлюють session;
- ambiguous failure не видається за успіх;
- `Retry-After` керує повторною спробою;
- 23 unit, 23 mocked Chromium і 8 real Chromium tests — PASS.

## 6. Етап 11 — організації, пристрої та модульна панель

| Операція | Результат |
|---|---|
| 11.1 — Організації й об’єкти | Реалізовано: lists, breadcrumbs, deep links, pagination, valid context restore; прийнято 28.09.2026 |
| 11.2 — Список пристроїв | Реалізовано: paginated rows, bounded presence calls, cancel old page requests; прийнято 28.09.2026 |
| 11.3 — Registry віджетів | Реалізовано: modules/channels, units, numeric/state, unsupported fallback; CI + Windows PASS, залишок ручного приймання |
| 11.4 — Якість/конфігурація | Реалізовано: fresh/stale/missing/invalid, session change, відображення enable/disable, revoke; CI + Windows PASS, залишок ручного приймання |

Summary endpoint додається лише після виміряної потреби, не наперед.

## 7. Етап 12 — графіки та команди

[Загальне досьє V3.5 — Етап 12](dossier-v3.5-stage-12-telemetry-commands.md):
усі чотири операції, виправлення, CI, Windows-докази та межі приймання.

| Операція | Результат |
|---|---|
| 12.1 — Історія | Реалізовано: metric, unit, period, bucket, min/max/average/count, gaps, timezone; CI та Windows PASS; перевірка прокрутки та F5 |
| 12.2 — Оновлення | Реалізовано: one polling policy, backoff, cancel/dedup, hidden-tab pause, budget; CI та Windows PASS; перевірка прокрутки та F5 |
| 12.3 — Start/Stop/frequency | Реалізовано: allowed_commands, validation, confirmation, one request_id; CI і Windows PASS на 5fa3afe; виправлення згортання та ручне приймання |
| 12.4 — Lifecycle/journal | Реалізовано: lifecycle, TTL, audit, bounded polling, keyset pagination; CI і Windows PASS на 5fa3afe; виправлення згортання та ручне приймання |

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
6. GET retry bounded; write/login/logout retry має окрему policy.
7. Mock data не маскують збій live API.
8. Frontend CI не замінює backend suite.
9. Access token не persist-иться; refresh token не читається JavaScript.
10. Cross-tab lock і logout marker metadata не містять token.
11. Session cache scope містить `user_id` і `auth_session_id`.
12. Route guard не є заміною server-side authorization.
13. Logout має відкликати server session до остаточного success state.
14. Невизначений logout result не видається за підтверджений вихід.

**Попередня точка приймання: ручні сценарії 11.3 та 11.4 після Windows PASS.**
11.1/11.2 закрито після CI, Windows 31/40/10 PASS і повідомлення користувача
«Работает» 28.09.2026. Прийнято 10/24. Користувач прямо доручив наступні дві
операції разом. CI 42 unit / 52 mocked / 10 live і 25 повторів регресій
без retries — PASS. Windows 28.09.2026 також 42/52/10 PASS; насос показано
на скриншотах. Решта ручних сценаріїв окремо не підтверджена.

[Загальне досьє V3.5 — Етап 11](dossier-v3.5-stage-11-inventory-modular-dashboard.md).

- [11.3 — registry віджетів](stage-11-op3-module-widgets.md)
- [11.4 — якість/конфігурація](stage-11-op4-quality-and-configuration.md)

## Попередня робота: 12.1–12.2

За дорученням користувача наступні дві операції реалізовано разом.
**CI прокрутки та F5: 61 unit / 71 mocked / 10 live та 34 додаткові повтори — PASS.**
Windows 28.09.2026 на `c6c215a`: **54/63/10 PASS**; графіки трьох метрик підтверджено.
Виправлено стрибок прокрутки при зміні фільтрів/оновленні; CI виправлення PASS,
повторна ручна перевірка очікується. Непідтверджені окремо сценарії не закрито.
[12.1 — історія](stage-12-op1-telemetry-history.md),
[12.2 — оновлення, результати та Windows-команда](stage-12-op2-polling.md).
[Збереження фільтрів F5](stage-12-history-preferences-2026-09-28.md) додано; CI 61/71/10 + 34 повтори PASS, ручна перевірка очікується.
Прийнятий прогрес не збільшується до завершення ручного підтвердження.

## Підсумок реалізації: 12.3–12.4

Користувач доручив наступні дві операції після виправлень графіків/F5.
Реалізовано [12.3 — керування](stage-12-op3-command-controls.md) і
[12.4 — lifecycle, журнал, результати та Windows-команда](stage-12-op4-command-journal.md).
Автоматичні докази та ручне приймання розділені; нові операції ще не оголошено прийнятими.

**Фінальний CI 12.3–12.4: 68 unit / 88 mocked / 10 live + 34 повтори — PASS.**
Backend: 160 тестів без skips, demo/restart/backup/restore — PASS.
Код перевірено в `bafc983`; backend — у `aaeaea7` (backend далі не змінювався).

Windows 28.09.2026 для 12.3–12.4: **88 mocked / 10 live / cumulative gate PASS**.
Поточне виправлення: [порожня область після згортання деталей](stage-12-details-collapse-2026-09-28.md).
Повне ручне приймання не закрито.

Виправлення згортання на `dde31a8`: **68 unit / 91 mocked / 10 live + 34 повтори — PASS**.
Windows-приймання виправлення очікується; базовий Windows gate 12.3–12.4 уже PASS.

Зведені результати зафіксовано у
[досьє V3.5 — Етап 12](dossier-v3.5-stage-12-telemetry-commands.md).
Наступна точка розробки — 13.1 (аварії) та 13.2 (acknowledge);
складання досьє не змінює прийнятий прогрес 10/24.
