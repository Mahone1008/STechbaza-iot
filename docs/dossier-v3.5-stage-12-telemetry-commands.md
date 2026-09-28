# Досьє V3.5 — Етап 12

## Історія телеметрії, оновлення, команди та журнал KERUMO

Дата фіксації: **28.09.2026**. Backend base: **0.38.0**.

**Реалізовано 4/4 операції. Фінальний frontend CI: 68 unit / 91 mocked /
10 live та 34 додаткові повтори — PASS. Backend: 160 tests, zero skips — PASS.**
Windows-прогони 12.1–12.2 та 12.3–12.4 підтверджені на відповідних revisions.
Останнє виправлення згортання деталей перевірене CI; окремого Windows/ручного
підтвердження після його встановлення ще немає. Загальне досьє фіксує
реалізацію та докази; повне ручне приймання етапу залишається відкритим.
Прийнятий frontend roadmap — **10/24**, без автоматичного збільшення лічильника.

## 1. Мета і результат

Етап 12 доповнив модульну панель Етапу 11 реальною історією вимірювань,
керованим фоновим оновленням, підтверджуваними командами та журналом їх
життєвого циклу. Користувач бачить дані API, розриви історії, обмеження
керування і результат, повідомлений контролером.

| Операція | Реалізований результат | Докази та приймання |
|---|---|---|
| 12.1 — Історія | Метрика, одиниці, період, інтервал, average/min/max, gaps, timezone і таблиця | CI PASS; Windows і графіки підтверджені; залишок ручних сценаріїв відкритий |
| 12.2 — Оновлення | Єдина polling policy, backoff, Retry-After, cancel/dedup, hidden/offline pause | CI і Windows PASS; окремі ручні сценарії відкриті |
| 12.3 — Start/Stop/frequency | Permissions, allowed_commands, validation, confirmation та один request_id на дію | CI і Windows PASS; Start/result simulator показано вручну |
| 12.4 — Lifecycle/journal | Статуси, TTL, ACK/result, автор, деталі та стабільна пагінація | CI і Windows PASS; журнал/audit показано; виправлення згортання очікує ручного підтвердження |

Детальні документи: [12.1](stage-12-op1-telemetry-history.md),
[12.2](stage-12-op2-polling.md), [12.3](stage-12-op3-command-controls.md),
[12.4](stage-12-op4-command-journal.md).

## 2. Історія телеметрії

Графік використовує `GET /api/v1/devices/{id}/telemetry/series`.
Метрики беруться лише з увімкнених modules/channels із числовим типом,
`supports_series=true` і `source=values`; одиниці надходять із backend.
Історія дискретних станів не підміняється усередненим числом.

| Параметр | Реалізоване правило |
|---|---|
| Рухомий період | 1 година, 6 годин, 24 години або 7 днів |
| Інтервал | 1/5/15 хвилин, 1/24 години; до 1000 buckets |
| Часова основа | `server_received_at`; запит у UTC, підписи й точне вікно в timezone об’єкта |
| Графік | Лінія average, відрізки minimum/maximum, окремі точки partial buckets |
| Пропуски | Empty/invalid/missing розривають лінію; нуль лишається значенням |
| Таблиця | Межі bucket, status, min/max/average, sample/missing/invalid counts |

Немає інтерполяції чи перенесення останнього показання через gap. Таблиця
є текстовою альтернативою SVG і прокручується всередині картки на вузькому
екрані. Нормалізація координат захищає SVG від Infinity/NaN на великих
скінченних значеннях.

Runtime validation перевіряє device/metric/unit/time_basis, точне вікно,
розмір, повноту і суміжність buckets, counts/status та скінченні агрегати.
Чужа або неузгоджена відповідь не рендериться. Cache key враховує
user/session/org/site/device та параметри історії; рухоме вікно не створює
новий ключ на кожне оновлення. Неактивний кеш видаляється (`gcTime: 0`).

`403/404` означає втрату доступу, `409` — необхідність перечитати модулі,
`422` — перевірити діапазон, `429` — витримати Retry-After. Більший bucket
не обходить backend-ліміт 100000 вхідних повідомлень.

## 3. Оновлення та бюджет запитів

Overview, вибрана series і стан вибраної команди використовують спільний
механізм `usePanelQuery` / `PollingBudget`. Режими панелі: 30 секунд,
60 секунд або «Лише вручну». Запити історії всіх метрик наперед не виконуються.

| Потік / умова | Поведінка |
|---|---|
| Overview і series за замовчуванням | До 2 overview + 1 series GET/хв після початкового завантаження; відлік після завершення запиту |
| Вибрана незавершена команда | Один detail GET кожні 5 с, до 10 хвилин; максимум 12 GET/хв |
| Загальний регулярний бюджет | До 15 GET/хв із вибраною незавершеною командою; журнал оновлюється вручну |
| Одночасність | Один запит на query; повторний ручний refresh не запускає дубль |
| Timeout / тимчасовий збій | 10 с на HTTP-запит; подвоєння backoff до базових 300 с плюс 0–10% jitter |
| Retry-After | Не скорочується backoff cap; діє також для ручного повтору |
| Permanent error / invalid response | Автоматичні повтори зупиняються до явної дії або нового контексту |
| Hidden / offline | Polling зупиняється, запити скасовуються |
| Visible / online | По одному оновленню активних queries без надолуження tick; чинний backoff збережено |
| Logout / навігація | Abort і session cache cleanup; запізніла відповідь не повертає старий екран |

Початкові запити, ручні дії, зміна фільтрів, повернення у вкладку,
preflight перед командою та auth/profile не входять до регулярного бюджету.
Авторизований GET може один раз повторитися після успішного refresh токена.
Кожна видима вкладка має власний бюджет; міжвкладкового лідера телеметрії немає.

У ручному режимі немає фонового polling команди. Після
`succeeded/failed/expired/result_unknown` автоматичні detail GET припиняються.
Пізній результат можна перечитати вручну. Локальний timer якості старить
показання без мережі; пауза не робить застарілі дані актуальними.

## 4. Збереження фільтрів і геометрії сторінки

Метрика, період та інтервал зберігаються у sessionStorage поточної вкладки
з прив’язкою до user/session/organization/device. Вибір відновлюється до
першого series-запиту після F5. Відключена метрика, пошкоджений JSON або
недопустимий bucket замінюються валідними параметрами. Logout/очищення
контексту видаляють відповідні налаштування; заборона storage не блокує UI.

Зберігаються лише три фільтри, без tokens, показань і API responses. Режим
оновлення та розкриття таблиці не persist-яться. «6 годин» після F5 — нове
рухоме вікно, а не попередні абсолютні start/end.

Під час зміни фільтрів, loading/error та фонового оновлення `StableRegion`
зберігає виміряну висоту, щоб документ не скорочувався під користувачем.
Старі дані приховані й недоступні. Явне згортання `<details>` перевимірює
висоту: картка автора/технічних деталей і таблиця вимірювань прибирають
звільнене місце. Наступне loading зберігає вже компактний резерв.
Коротший асинхронний результат може зберігати резерв; вихід із пристрою
скидає його. Програмного `scrollTo` не додано.

Докази: [F5](stage-12-history-preferences-2026-09-28.md),
[прокрутка](stage-12-op2-polling.md),
[згортання деталей](stage-12-details-collapse-2026-09-28.md).

## 5. Підтвердження і надсилання команд

Керування залежить від `command.execute`, призначених modules і серверних
`allowed_commands`. Viewer бачить журнал без форми керування. Перед POST
виконується свіжий overview; backend повторно перевіряє authorization.
Start/frequency блокуються без актуального зв’язку. Offline Stop може
очікувати доставки на сервері до завершення TTL.

Частота — скінченне число **0–100 Гц**, включно з нулем; порожнє поле не
вважається нулем. Це межі протоколу. TTL прийому — ціле **5–300 с**,
типово **30 с**. Діалог показує пристрій, UID, дію, частоту й TTL.

Один `request_id` створюється після явного підтвердження; синхронний guard
не допускає подвійного POST. Автоматичних повторів POST немає, включно з
401. Receipt перевіряється за device, organization, actor user, request_id,
типом, payload і TTL. HTTP 201/200 підтверджує реєстрацію або повернення
наявної команди, а не фізичне виконання.

Після невизначеного результату POST спочатку пропонується перевірити журнал.
Ручний повтор потребує підтвердження та надсилає той самий request_id і тіло.
Локальний монотонний deadline обмежує повтор початковим TTL; серверний TTL
відраховується від durable record. Retry-After витримується без автоматичної
відправки після таймера. Завершення перевірки не скасовує попередню команду.

Pending intent не записується у storage. F5/reconnect/повернення до пристрою
не надсилають стару команду. Abort припиняє очікування відповіді, але не
гарантує скасування команди, яку сервер уже прийняв.

## 6. Lifecycle, аудит і пагінація журналу

UI відрізняє `queued`, `published`, `acknowledged`, `succeeded`, `failed`,
`expired` і `result_unknown`. ACK — підтвердження прийому контролером.
Result — повідомлений ним результат; його слід зіставляти з телеметрією.
Статус береться із сервера і не змінюється на expired за годинником браузера.

Деталі містять час створення/публікації/ACK/завершення, TTL прийому,
окремий result deadline/timeout, payload/result, автора та роль на час
запиту, command/request IDs, спроби й помилки публікації/виконання.
Текст і JSON відображаються як escaped React content.

Для журналу розширено наявний `GET /api/v1/devices/{id}/commands`:

| Контракт | Поведінка |
|---|---|
| Сумісність | `limit`/`offset` і відповідь-масив збережені |
| Курсор | Пара `before_created_at` із timezone та `before_id` |
| Порядок | `created_at DESC, id DESC`; наступна сторінка строго перед курсором |
| Валідація | Неповна пара або курсор із ненульовим offset → 422 |
| UI | Запит 21 запису, показ 20, lookahead і стек курсорів для повернення |
| Оновлення | Ручне повернення до першої сторінки; нові записи не зсувають межу наступної |

Це не snapshot isolation: поточні статуси перечитуються при GET. Parser
перевіряє tenant/device, дублікати, порядок, межу сторінки й курсор;
порівняння часу зберігає мікросекунди PostgreSQL.

Backend лишається **0.38.0 / 47 paths / 17 migrations**. Етап 12.4 додав
сумісні query parameters, repository/service/API plumbing та PostgreSQL/HTTP
тести; нових paths і міграцій немає. OpenAPI JSON та generated TypeScript
оновлено. Backend після `aaeaea7` не змінювався.

## 7. Перевірки і revisions

Фінальна перевірена frontend code revision:
[`dde31a8`](https://github.com/Mahone1008/STechbaza-iot/commit/dde31a8ac3841cb4f5ab8f32037dd5d10be17f83).
[Frontend checks #36462683461](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36462683461)
— **success**. Наведені числа стосуються повних cumulative suites, а не лише
нових тестів Етапу 12.

| Перевірка | Результат |
|---|---|
| OpenAPI generation / zero diff / verify | PASS; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | 68 PASS, 13 файлів |
| Mocked Chromium | 91 PASS, без failed/flaky |
| Додаткові повтори, retries=0 | 34 PASS: 10 login + 15 overview + 9 polling |
| Live Chromium, реальний demo backend | 10 PASS, включно з series та UI Stop → MQTT ACK/result → журнал |
| Backend checks | 160 tests, zero skips — PASS на `aaeaea7` |
| Windows бази 12.1–12.2 | 54 unit / 63 mocked / 10 live — PASS на `c6c215a` |
| Windows бази 12.3–12.4 | 88 mocked / 10 live / cumulative gate — PASS на `5fa3afe` |
| Windows/manual останнього виправлення згортання | Окреме підтвердження очікується |

[Backend checks #36457558266](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36457558266)
на [`aaeaea7`](https://github.com/Mahone1008/STechbaza-iot/commit/aaeaea7e7ac261a8a6ee9c55eb8a983b0c62c497)
підтвердив PostgreSQL/MQTT tests, browser auth, migration roundtrip,
HTTP/MQTT demo, simulator/backend/broker restart, H-04/H-05 та backup/restore.
Локальний backend-прогін без сервісів (75 PASS, 85 skips) не видається за цей
повний CI. Frontend локально пройшов types/lint, 68 unit і production build.

Нові перевірки охоплюють контракти series, gaps/нуль, polling budget,
Retry-After, hidden/offline, revoke і late responses, F5/storage isolation,
confirmation/idempotency/TTL, viewer/mobile, стабільні сторінки журналу.
Три регресії згортання перевіряють деталі мишею/Enter на desktop/mobile та
таблицю вимірювань із наступним loading. Live command test має явний opt-in
`KERUMO_RUN_COMMAND_DEMO=1` і працює лише з localhost `TB-DEMO-PUMP` simulator.

### Історія корекцій

| Крок | Результат |
|---|---|
| Початкові 12.1–12.2 | Уточнено accessible labels і native disabled option, посилено dedup; [CI #36439217358](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36439217358), `5f2d8a8`: 54/63/10 + 34 повтори PASS |
| Стрибок сторінки при фільтрах | StableRegion і збереження геометрії overview/history; [CI #36444284411](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36444284411), `65cf63a`: 54/67/10 + 34 повтори PASS |
| Скидання фільтрів після F5 | Валідовані session-scoped preferences; [CI #36453410087](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36453410087), `f0d4681`: 61/71/10 + 34 повтори PASS |
| 12.3–12.4 | Узгоджено empty-module fixture з command_types, додано явне посилання «Деталі»; [CI #36458233494](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36458233494), `bafc983`: 68/88/10 + 34 повтори PASS |
| Порожнє місце після згортання | Native toggle скидає резерв до поточної висоти; `dde31a8`: 68/91/10 + 34 повтори PASS |

У scroll regression Playwright `locator.click()` сам пересував уже видиму
кнопку. Після перевірки trace тест використовує pointer click у її видимий
центр; перевірка scrollY з допуском 2 px і приховування старих даних збережена.
Невдалу гіпотезу вимкнення scroll anchoring вилучено. Пізніші documentation
commits не змінюють перевірений код; це досьє також є документаційною зміною.

## 8. Windows і ручні докази від 28.09.2026

Результати першої серії 12.1–12.2 зафіксовані в [12.2](stage-12-op2-polling.md):
повний Windows PASS, графіки pressure/current/frequency, одиниці bar/A/Hz,
Europe/Kyiv, нулі та gaps. Остання серія 12.3–12.4 підтверджує наведене нижче.
Саме зображення не комітиться; у таблиці вказані суфікси наданих файлів.

| Скриншот | Спостереження |
|---|---|
| 20260928-175458 / 175519 | Усі 88 mocked browser tests PASS, включно з command/journal, F5 і scroll |
| 175539 / 175612 / 175640 | Cumulative baseline, backend build, seed зі збереженням demo data/credentials і modules |
| 175719 / 175734 | 10 live PASS, фінальний cumulative command/lifecycle/journal gate PASS, frontend Ready |
| 175805 | TTL 35 с, частота 800 Гц і disabled frequency: значення поза протоколом 0–100 Гц; notice про прийнятий Start |
| 175821 | Start має succeeded/result `pump_running=true`, автора і часові позначки |
| 175852 | Ті самі деталі згорнуті, але лишилася порожня область; причина останнього виправлення |
| 175926 / 175951 | Online/свіжа телеметрія, журнал із succeeded/failed та посиланнями «Деталі» |

Повного окремого числового unit-підсумку в останній серії немає; його
успішність підтверджена завершеним cumulative gate. Ці скриншоти стосуються
бази `5fa3afe`, а не Windows-перевірки нового `dde31a8`.

## 9. Відтворення та залишок ручного приймання

Для повного Windows gate: запустити Docker Desktop і зупинити попередній
frontend через Ctrl+C. У PowerShell виконати весь блок:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage12-op3-op4.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 12 verification failed.' }
}
```

Скрипт зберігає чинні demo credentials/data, проходить cumulative gate,
перевіряє Stop лише на demo simulator і запускає frontend після PASS.
Вхід: `http://127.0.0.1:3000/login` з чинними demo credentials; паролі тут
не публікуються. Для швидкого оновлення тільки виправлення згортання є
[окрема команда](stage-12-details-collapse-2026-09-28.md); повторний повний
gate не потрібен лише через додавання цього документа.

Залишаються окремо не зафіксовані ручні перевірки:

1. Після оновлення згортання автора/технічних деталей і таблиці вимірювань
   прибирає вільне місце; loading/error продовжують утримувати прокрутку.
2. Метрика/період/інтервал зберігаються після F5; зміна фільтрів не переносить
   користувача над графіками. F5 не повторює команду.
3. Pause/hidden/offline/reconnect, viewer/mobile, зміна пристрою та logout
   не відновлюють старі дані або pending intent.
4. Підтвердження і скасування Start/Stop/допустимої частоти, TTL та окреме
   порівняння прийому, ACK, result і телеметрії simulator.
5. Наступна/попередня сторінки журналу, ручне оновлення та нова команда між
   сторінками без дублювання записів.

Автоматичне покриття цих сценаріїв пройшло; воно не підміняє окреме ручне
приймання. Відкриті ручні пункти Етапу 11 також зберігаються у його досьє.

## 10. Межі, наступна точка і пов’язані документи

Немає довільного календарного діапазону, експорту історії, retention/rollups,
історії дискретних станів, push/WebSocket або browser MQTT. Не реалізовано
локальну offline queue команд, provisioning, редактор module config чи
налаштування індивідуальних робочих меж частотника.

Alarms у frontend залишаються демонстраційними. Наступні дві операції за
roadmap: **13.1 — аварії, filters/severity/status/detail/transitions** та
**13.2 — acknowledge із permissions, pending/error та concurrent resolution**.
Це наступна точка розробки; реалізацію 13.1–13.2 це досьє не засвідчує.

Ці результати не підтверджують production readiness, фізичну firmware або
навантаження 10 000 контролерів. UI/live simulator tests і випробування
фізичного обладнання мають різні межі доказів.

- [Frontend roadmap](frontend-roadmap-v1.md)
- [Досьє V3.5 — Етап 11](dossier-v3.5-stage-11-inventory-modular-dashboard.md)
- [12.1 — історія](stage-12-op1-telemetry-history.md)
- [12.2 — оновлення](stage-12-op2-polling.md)
- [12.3 — керування](stage-12-op3-command-controls.md)
- [12.4 — lifecycle і журнал](stage-12-op4-command-journal.md)
- [Telemetry panel/charts contract](telemetry-panel-charts-v1.md)
- [Module/channel contract](module-channel-contract-v1.md)
- [Frontend API contract](frontend-api-contract-v1.md)
- [Demo stand](demo-stand-v1.md)
- [Індекс документації](README.md)
