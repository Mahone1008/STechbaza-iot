# Контракт API перших екранів — Етап 8, операції 1–3

Поточна версія backend: **0.38.0**, міграція **20260926_0017**.
H-04 додає [модулі, канали й типізовані state readings](module-channel-contract-v1.md).
Статус фінального приймання H-04/H-05: [журнал Етапу H](stage-h-backend-corrections.md).
Початковий контракт створено в операції 1 для 0.32.0; нижче враховано
browser auth операції 2 та якість показань і графіки операції 3.
В операції 4 додано [окремий demo-стенд](demo-stand-v1.md) на порту 8001
для цих API; формат відповідей цією операцією не змінено.
Операція 5 додає [комплексні перевірки та recovery](comprehensive-checks-v1.md);
контракт HTTP та міграція залишаються без змін.
Цей документ закріплює інтеграцію перших екранів; UI ще не реалізовано.
Статус операції та приймання: [журнал Етапу 8](stage-8-test-backend.md).

## 1. Що означає контракт

Контракт — домовленість про HTTP-шлях, параметри, відповідь і помилки.
Фронтенд використовує ці поля, а backend перевіряє доступ до даних і дій.
Машиночитана схема доступна у `/openapi.json`, інтерактивна — у `/docs`.
Усі нижченаведені шляхи мають префікс `/api/v1` і потребують Bearer JWT,
крім browser login/refresh/logout, які мають власні правила cookie/CSRF.
Правила browser session/CORS: [Browser authentication v1](browser-auth-v1.md).

## 2. Карта перших екранів

| Екран або дія | Запити | Важлива поведінка |
|---|---|---|
| Вхід | `POST /auth/browser/login`, `GET /auth/me` | Browser flow 0.33.0: [cookie, refresh та CORS](browser-auth-v1.md); JWT перевіряється разом із server-side session |
| Вибір клієнта | `GET /organizations` | Лише доступні організації; superadmin має глобальний доступ |
| Меню клієнта | `GET /organizations/{id}/access` | Поточні permissions, без копії таблиці ролей у UI |
| Об'єкти | `GET /organizations/{id}/sites` | Tenant isolation на сервері |
| Список контролерів | `GET /sites/{id}/devices` | Базові реквізити; не завантажує історію всіх пристроїв |
| Сторінка контролера | `GET /devices/{id}/overview` | Enabled capabilities, ключі показників, права, availability і snapshot |
| Керування | `POST /devices/{id}/commands`, `GET /commands/{id}` | Власний request_id; ACK ще не означає виконання |
| Історія команд | `GET /devices/{id}/commands` | Збережені статуси, строки та audit автора |
| Журнал подій | `GET /devices/{id}/events` | Фільтри типу, severity, source та часу |
| Аварії | `GET /devices/{id}/alarms`, `GET /alarms/{id}/transitions` | Active/resolved і acknowledge — різні характеристики |
| Підтвердження аварії | `POST /alarms/{id}/acknowledge` | Потрібне `alarm.acknowledge`; читання повідомлення не підтверджує аварію |
| Повідомлення | `GET /organizations/{id}/notifications`, `.../unread-count` | Спільна історія та особисте прочитання |
| Прочитати повідомлення | `POST /notifications/{id}/read` | Повтор зберігає початковий read_at |
| Налаштування модулів | `GET /devices/{id}/capabilities`, `PATCH /devices/{id}/capabilities/{capability_id}` | Повний список assignments, включно з вимкненими; зміни потребують `capability.manage` |
| Історія пакетів | `GET /devices/{id}/telemetry` | Сирі пакети, стабільне сортування received_at DESC, id DESC |
| Графік показника | `GET /devices/{id}/telemetry/series` | UTC-період, min/max/average, пропуски та обмеження: [контракт графіків](telemetry-panel-charts-v1.md) |

`GET /auth/me` повертає identity, session та memberships, але не замінює
актуальний `/organizations/{id}/access`. Не слід вважати membership у
старій відповіді доказом поточного доступу або активності організації.

## 3. Права вибраної організації

`GET /organizations/{organization_id}/access`

| Поле | Значення |
|---|---|
| `organization_id` | UUID перевіреної організації |
| `platform_role` | `user`, `service_admin` або `superadmin` |
| `organization_role` | Роль поточного membership; `null` для superadmin bypass |
| `permissions` | Відсортований список доступних tenant permissions |

Список будується з тієї самої `roles.py`, яку використовують authorization
guards. Для viewer немає `command.execute` та `alarm.acknowledge`.
Для superadmin повертаються всі визначені tenant permissions. Його право
на глобальні адміністративні дії не слід виводити з tenant permissions.
Service admin без активного membership не отримує доступ до клієнта.

Дані актуальні на момент запиту. UI використовує їх для кнопок і меню;
кожен write endpoint повторно перевіряє права. Після 401/403/404 UI повинен
оновити контекст або завершити доступ до ресурсу, а не повторювати дію
нескінченно за старим кешем.

## 4. Єдиний огляд пристрою

`GET /devices/{device_id}/overview`

Потрібні `device.read`, `capability.read` і `telemetry.read`. Відповідь:

| Поле | Зміст |
|---|---|
| `generated_at` | Серверний час складання відповіді, не час вимірювання |
| `device` | Поточний `DeviceRead`: UUID, Site, UID, назва, lifecycle та timestamps |
| `access` | Той самий формат прав, що й organization access |
| `availability` | `online`, `last_seen_at`, `timeout_seconds`, `seconds_since_seen`, Device ID і UID |
| `capabilities` | Каталожні metadata лише реально призначених enabled capabilities, за code ASC |
| `modules` | Enabled assignments з assignment_id, capability_id, code, supported, channels та командами з урахуванням ролі |
| `value_keys` | Підтримувані ключі `values` для цього набору capabilities |
| `state_keys` | Підтримувані ключі `state` для цього набору capabilities |
| `command_types` | Команди, підтримувані enabled capabilities пристрою |
| `allowed_commands` | Підмножина command_types з урахуванням `command.execute` поточного користувача |
| `snapshot` | `DeviceStateRead` або `null`; значення відфільтровані за доступними ключами |
| `telemetry_freshness` | Давність пакета: missing/fresh/stale, причина, timestamps і поріг |
| `readings` | Показники enabled capabilities: key, unit, nullable numeric value і missing/invalid/fresh/stale |
| `state_readings` | Boolean/integer state-показники з тією самою якістю; false/0 відрізняються від null |

Capabilities — можливості пристрою, наприклад `pressure.read`, а не
список однакових датчиків для всіх клієнтів. У цьому read model не
повертається довільний assignment config; для конфігурації є окремий API.

Правила формування ключів і команд беруться з чинних backend policies:
`VALUE_CAPABILITY_REQUIREMENTS`, `STATE_CAPABILITY_REQUIREMENTS`,
`COMMAND_REQUIRED_CAPABILITY`. H-04 отримує ці policies та units з єдиного
`app/device_contract.py`. Не створено другу незалежну таблицю
підтримки обладнання. Невідомий capability code може бути у каталозі та
assignments, але не створює підтримувану telemetry key або команду.
У modules такий code позначений `supported=false`. Повний контракт та межа
між логічним capability і фізичним датчиком описані в [H-04](module-channel-contract-v1.md).

### Модульні приклади

| Реальний склад | value_keys | command_types | allowed_commands viewer |
|---|---|---|---|
| Немає enabled capabilities | `[]` | `[]` | `[]` |
| Лише `pressure.read` | `["pressure.bar"]` | `[]` | `[]` |
| Лише `vfd.control` | `[]` | `["vfd.frequency.set", "vfd.start", "vfd.stop"]` | `[]` |
| `vfd.control` + `pressure.read` | `["pressure.bar"]` | Три VFD-команди | `[]` |

Operator із `vfd.control` бачить три allowed_commands. Вимкнення цієї
capability прибирає їх; write endpoint також повертає 409. Viewer не
може обійти обмеження, вручну надіславши POST: сервер повертає 403.

### Відсутні та збережені дані

- До першої телеметрії `snapshot: null`, навіть якщо capability вже є.
- Відсутній ключ у snapshot означає відсутність значення, а не нуль.
- Числовий `0` — реальне показання. `false` зберігається у state;
  boolean у числовому показнику є invalid, а не числом 0.
- У числовому snapshot.values некоректне значення повертається як null,
  readings позначає його invalid. База та сирий історичний API не змінюються.
- Показники вимкненого або непризначеного модуля не потрапляють до overview.
- Збережений snapshot та історія в БД не змінюються від GET-запиту.
- Старий `/state` зберігає попередню поведінку: 404 до першого snapshot
  і сирий snapshot після нього. Для віджетів використовується overview.
- `online: true` не гарантує свіжість кожного показника: heartbeat може
  бути новим, а остання телеметрія — старою. Потрібно показувати час даних.
- Після втрати зв'язку останні дані можуть залишатися у snapshot разом
  з `online: false`. Їх не можна підміняти нулем або видавати за нові.
- Операція 3 додає явну давність пакета і статус кожного показника.
  Це час останнього пакета, а не незалежний timestamp кожного датчика.
  Відсутні ключі часткового пакета не переносяться з попереднього.
- Overview і series повертають `Cache-Control: no-store` при успіху.

### Межі огляду

Overview не читає нескінченні журнали та не виконує команду. Це кілька
коротких читань; він не оголошується атомарним знімком усіх таблиць у
єдину мить. Після зміни ролі або складу модулів наступний запит показує
новий стан. Остаточне рішення про дію приймає відповідний write endpoint.
Allowed_commands не враховує фізичні блокування VFD і не гарантує зв'язок
або виконання. Фізичний результат підтверджує тільки command Result.

## 5. Списки та сторінки

Списки повертають JSON-масиви; порожній результат — `[]`, не 404.
Обгортки `items/total` у поточній версії немає.

| Список | limit за замовчуванням | Максимум |
|---|---|---|
| Organizations, Sites, Devices, Commands | 50 | 100 |
| Каталог capabilities | 100 | 100 |
| Telemetry, Events, Alarms, Notifications | 50 | 200 |
| Alarm transitions | 100 | 500 |

`offset >= 0`. Organizations, Sites і Devices тепер сортуються за
`created_at DESC, id DESC`: однаковий timestamp не залишає порядок
між двома рядками невизначеним. Це не cursor pagination: якщо між
запитами з'явилися нові рядки, offset-сторінки можуть зміститися.
Фронтенд дедуплікує записи за ID та оновлює список після змін.
Device capabilities повертаються окремим непагінованим списком.

## 6. Помилки і стани інтерфейсу

Нові access/overview маршрути зберігають стандартний формат API:
`{"detail": "текст"}` для помилок доступу. Валідація 422 повертає
`{"detail": [{"loc": [...], "msg": "...", "type": "...", ...}]}`.
Старі діагностичні маршрути можуть мати detail-об'єкт; новий універсальний
error envelope для всього проєкту цією операцією не вводиться.

| HTTP | Значення | Поведінка UI |
|---|---|---|
| 401 | JWT/session немає, недійсна, прострочена або відкликана | Обробити session за auth flow; без нескінченних retries |
| 403 | Недостатньо прав або обліковий запис вимкнений | Показати відмову, оновити доступ |
| 404 | Ресурс відсутній або не належить доступному tenant | Показати недоступність; не розкривати чужого клієнта |
| 409 | Конфлікт дії: capability, request_id, resolved acknowledge тощо | Оновити стан і пояснити конфлікт |
| 422 | Неправильні поля або завеликий період/обсяг графіка | Обробити detail-масив валідації або detail-рядок бізнес-помилки |
| 5xx / network failure | Тимчасова недоступність | Зберегти видимий стан помилки; GET можна повторити з паузою |

Текст detail не є машинним ідентифікатором помилки. Не прив'язувати
логіку фронтенду до точного українського формулювання. Окремі machine
error codes можна додати сумісним розширенням за потреби екранів.
Loading, empty, offline, no telemetry та access denied — різні UI-стани.

## 7. Запити керування

Поточні команди: `vfd.start`, `vfd.stop`, `vfd.frequency.set`.
Клієнт генерує request_id один раз на намір користувача. При втраті HTTP
відповіді повторює той самий request_id і payload, а не створює новий.
POST повертає 201 для нової команди та 200 для тотожного повтору.
TTL від 5 до 300 секунд, типово 30. Start/stop мають порожній payload;
frequency.set — `{"frequency_hz": 40}`. Поточна API-межа частоти 0..100
є протокольною; межі конкретної установки потребують окремої конфігурації.

Успішний POST або command ACK не означає фізичний запуск. UI читає
command status. `result_unknown` відображається як невідомий результат,
а не як успіх; він не є підставою автоматично створювати новий Start.
Докладний lifecycle: [Command Reliability v1](command-reliability-v1.md).

## 8. Історія перевірок

В операції 1 додано 10 тестів:

1. Відмова без JWT і з неправильним JWT для обох нових маршрутів.
2. OpenAPI: Bearer, UUID, response models, 401/403/404/422, nullable snapshot.
3. Новий пристрій: empty capabilities та snapshot null.
4. Enabled/disabled/чужі/невідомі capabilities; фільтрація значень без зміни БД.
5. Ролі та allowed_commands; серверні відмови 403 і 409 при POST.
6. Tenant isolation, service_admin, superadmin, inactive organization та membership revoke.
7. Session revoke, disabled user та некоректні UUID.
8. Збережені показники offline-пристрою.
9. Стабільні сторінки при однакових timestamps і неправильні query limits.
10. Повний ланцюжок читання перших екранів і порожніх стрічок.

Повний набір після операції 1: **38 тестів**, з них 21 потребує opt-in
PostgreSQL/MQTT. Без flags перевірено лише 17, це не повний integration run.
Нові тести створюють власні тимчасові UUID й прибирають їх. При примусовому
перериванні процесу cleanup може не виконатись. Штатний запуск — з
зупиненим основним backend, як у прийманні Етапу 7.

Операція 2 розширила набір до 54 тестів та додала Chromium-перевірку.
Операція 3 додає 20 тестів: разом 74, з них 44 потребують PostgreSQL/MQTT.
Результати CI й локального приймання кожної версії зберігаються в журналі Етапу 8.

## 9. Приймання Етапу 8 та подальші роботи

Усі шість операцій Етапу 8 закрито 26.09.2026 після CI й локального приймання:

- Операція 1: контракт API перших екранів, актуальні permissions/capabilities.
- Операція 2: browser auth, refresh/logout, origin/CORS, захист входу.
- Операція 3: часові вибірки, ліміти графіків, давність і якість даних.
- Операція 4: постійний демонстраційний стенд з різними modules/tenants/roles.
- Операція 5: комплексні перевірки й live simulator/backend/broker recovery.
- Операція 6: [clean install, backup/restore](backup-restore-v1.md),
  109 tests без skips, 20 таблиць і SQLite після restore, захист sessions/commands.

[Тестова збірка 0.37.0 прийнята](test-backend-release-v1.md).
Після Етапу 8 додано коригувальний Етап H. Наступний функціональний етап —
**Етап 9: фронтенд**, після приймання H-04/H-05; реалізація ще не розпочата.
B2B/QR onboarding, зовнішні notification channels, production TLS/ACL
та фізичний пілот мають окремі критерії готовності.
