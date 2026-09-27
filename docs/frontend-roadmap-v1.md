# Frontend v1 — поетапний план KERUMO

Дата: 27.09.2026. База: backend **0.38.0**, Етап H завершено 5/5.

**Статус: роботу над frontend розпочато. Прийнято 1 із 24 операцій.
Операцію 9.1 закрито 27.09.2026; поточна точка — 9.2.**

Frontend поділено на Етапи 9–14. Кожен етап має чотири операції. Нумерація
попередніх backend-етапів та H-01–H-05 залишається незмінною.

## 1. Результат frontend v1

Користувач входить у кабінет, обирає організацію й об’єкт, бачить доступні
пристрої та лише фактично призначені їм модулі. Панель показує якість і давність
даних, графіки, дозволені команди з реальним lifecycle, аварії, події та
персональні позначки прочитання. Інтерфейс працює на ПК і мобільному браузері
з чинним demo API.

Перший release не включає billing, B2B invitation/QR claim, масове provisioning,
редактор alarm rules, камери, OTA, native app або offline queue для команд.
Ці можливості потребують окремих backend + UI + test вертикалей.

## 2. Технічна основа

- **React + Next.js + TypeScript strict**.
- FastAPI залишається єдиним backend та джерелом auth/RBAC/business rules.
- DTO генеруються з `/openapi.json`; критичні межі мають runtime validation.
- Server state — TanStack Query із cache keys за user/session/tenant/device.
- Access token зберігається лише в пам’яті; refresh cookie — HttpOnly.
- На старті використовуємо bounded HTTP polling лише видимих даних.
- Component tests + Playwright; фінальне E2E проходить через реальний demo API/MQTT.
- Локальні адреси: UI `http://127.0.0.1:3000`, demo API `http://127.0.0.1:8001`.

## 3. Екрани та API

| Екран | Основні endpoint-и | Критичне правило |
|---|---|---|
| Login/session | browser login/refresh/logout, `/auth/me` | один session coordinator; refresh cookie не читає JS |
| Організації/об’єкти | `/organizations`, access, sites | URL не надає доступ сам по собі |
| Пристрої | devices, availability | bounded pagination/status calls |
| Device dashboard | `/devices/{id}/overview` | modules/readings/state/permissions із backend |
| Графіки | telemetry series | missing — gap, zero — значення |
| Команди | create/list/get command | один request_id на намір; ACK ≠ Result |
| Аварії/події | alarms, transitions, events | acknowledge ≠ resolved |
| Повідомлення | notifications, unread-count, read | read персональне й не замінює acknowledge |

## 4. Етап 9 — структура інтерфейсу та основа

**Статус Етапу 9: 1/4.**

| Операція | Результат | Статус |
|---|---|---|
| 9.1 — Сценарії та макети | KERUMO light industrial SaaS visual system, карта сторінок, ролі, desktop/mobile, loading/empty/offline/error/command states | **Закрито 27.09.2026** після приймання ревізії 2 |
| 9.2 — Каркас і компоненти | Next.js/TS strict, design tokens, navigation shell, базові buttons/forms/tables/status/dialog, config example і lockfile | Наступна операція |
| 9.3 — API adapter і контракти | OpenAPI types, base URL, timeout, AbortSignal, error mapping, query keys і cache lifecycle | Заплановано |
| 9.4 — Відтворюваний baseline | typecheck, lint, build, початкові component/browser tests, frontend CI та інструкція чистого запуску | Заплановано |

Досьє 9.1: [UX-сценарії та макети KERUMO](stage-9-op1-ux-and-mockups.md).

## 5. Етап 10 — вхід, сесія та права

| Операція | Результат |
|---|---|
| 10.1 — Login | email/password, CSRF, credentials include, login errors і 429/Retry-After |
| 10.2 — Відновлення session | reload, single-flight refresh, coordination між вкладками, захист від race |
| 10.3 — Permissions і route guards | `/auth/me`, актуальний organization access, cache isolation і server-side guards |
| 10.4 — Logout і збої | coordinated logout, cancel pending requests, network/reconnect і відсутність session resurrection |

Автоматичний повтор write після 401 не допускається без окремої policy.
При повторі команди зберігається той самий request_id.

## 6. Етап 11 — об’єкти, пристрої та модульна панель

| Операція | Результат |
|---|---|
| 11.1 — Організації й об’єкти | списки, breadcrumbs, deep links, pagination і валідне відновлення context |
| 11.2 — Список пристроїв | пагіновані rows, availability видимої сторінки, cancel старих status-запитів |
| 11.3 — Registry віджетів | UI за modules/channels; units, numeric/state readings, unsupported fallback |
| 11.4 — Якість і зміна конфігурації | fresh/stale/missing/invalid, session change, enable/disable module, lost permission |

Не запускаємо overview для всього парку. Summary endpoint додається лише після
вимірювання реального fan-out.

## 7. Етап 12 — графіки та команди

| Операція | Результат |
|---|---|
| 12.1 — Історія показань | metric, unit, period, buckets, min/max/average/count, gaps і timezone |
| 12.2 — Оновлення даних | єдина polling policy, backoff, dedup/cancel, hidden-tab pause і request budget |
| 12.3 — Start/Stop/частота | allowed_commands, validation, confirmation, double-click protection і один intent |
| 12.4 — Lifecycle та журнал | queued/published/acknowledged/succeeded/failed/expired/result_unknown, audit і стабільна pagination |

Start і зміна frequency не накопичуються локально для відправки після reconnect.
ACK не показується як фізичне виконання. R-09 backend tie-breaker виконується у 12.4.

## 8. Етап 13 — аварії, події та повідомлення

| Операція | Результат |
|---|---|
| 13.1 — Аварії пристрою | filters, severity, active/resolved, detail і transitions |
| 13.2 — Acknowledge | permission, pending/error, idempotency і паралельне resolution |
| 13.3 — In-app feed | organization stream, unread count, personal read і tenant isolation |
| 13.4 — Наскрізний інцидент | MQTT → rule → alarm → notification → acknowledge → recovery через UI |

Глобальне зведення active alarms не симулюється сотнями Device-запитів; за
потреби це буде окремий bounded API.

## 9. Етап 14 — якість і приймання frontend v1

| Операція | Результат |
|---|---|
| 14.1 — Повна UX-перевірка | mobile/tablet/desktop, keyboard, focus, contrast, text zoom, loading/error/empty |
| 14.2 — Browser regression | Playwright: login → object → Device → chart → command → alarm; ролі, tenants, tabs |
| 14.3 — Security і performance | cache isolation, session races, escaping, CSP/headers, requests/heap/bundle/latency, dependency scan |
| 14.4 — Release і досьє | production build, clean run, real demo E2E, revision/version evidence, release notes і user acceptance |

Responsive, accessibility і tests починаються в 9.2; Етап 14 є фінальним gate,
а не першою спробою виправити готовий desktop.

## 10. Незмінні правила даних і безпеки

1. Module assignment не дорівнює фізичному sensor instance.
2. Online, fresh telemetry, HTTP success, MQTT ACK і фізичний Result — різні стани.
3. Права беруться з API; прихована кнопка не є authorization test.
4. Logout/context switch скасовують запити та очищають tenant/device cache.
5. Графік не домальовує нуль через missing або безперервну лінію через gap.
6. GET retries bounded; 401/403/404/422 не запускають нескінченні повтори.
7. Write retries мають окремі правила й не створюють новий intent автоматично.
8. Mock data дозволені в tests/preview, але production UI не маскує ними збій API.
9. E2E використовує ізольовані fixtures та не видаляє demo volumes користувача.
10. Новий frontend CI не замінює чинний backend suite.

## 11. Вузькі залежності від backend

- 9.3: фактична OpenAPI schema й error adapter;
- 11.2: summary API лише за виміряної потреби;
- 12.4: стабільний tie-breaker command history;
- майбутні create forms: name/timezone validation;
- майбутній rule editor: metric/config validation і semantics оновлення rules.

Не додаємо Kubernetes, Kafka, Redis, microservices або великий backend rewrite
без виміряної потреби першого UI.

## 12. Формат роботи й поточна точка

Кожна операція: обмежена зміна в `main` → автоматичні перевірки → один
відтворюваний PowerShell-блок → користувацьке підтвердження → фіксація в досьє.
Наступна операція не закривається автоматично. Нові branches не створюються.

**Поточна точка: операція 9.2 — Next.js/TypeScript strict, design system,
navigation shell і базові компоненти.**
