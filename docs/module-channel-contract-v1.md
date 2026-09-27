# Модулі та канали першого UI — H-04

Backend **0.38.0**, API v1, migration **20260926_0017**.
Статус приймання: [Етап H](stage-h-backend-corrections.md).

## 1. Модель

`GET /api/v1/devices/{id}/overview` повертає `modules` — опис лише enabled
capability assignments цього Device. Модуль тут є логічною можливістю,
наприклад `pressure.read` чи `vfd.control`. Це не автоматично виявлена
фізична плата, RS-485 адреса або підтвердження справності датчика.

Кожен запис містить:

| Поле | Значення |
|---|---|
| `assignment_id` | UUID прив'язки можливості до цього Device |
| `capability_id` | UUID каталожної capability; зв'язок з `overview.capabilities` |
| `code` | Стабільний код capability, також ключ для зіставлення в UI |
| `supported` | Backend реалізує хоча б один канал або команду цієї capability |
| `channels` | Підтримувані telemetry-канали; порожній список для control-only модуля |
| `command_types` | Реалізовані команди модуля |
| `allowed_commands` | Команди з урахуванням поточного `command.execute` |

Каталожні name/description беруться з `capabilities` за capability_id.
Довільний assignment config у цей DTO не копіюється.
Невідомий enabled code має `supported=false`, порожні channels/commands.
Запис довільних `channels` або `command_types` у config не додає підтримку.

Порядок стабільний: modules за code ASC, channels за source/key ASC,
commands за назвою ASC. Вимкнений або непризначений модуль не з'являється
в modules, keys, readings чи доступних командах. Наявність старої telemetry
не повертає віджет вимкненого модуля.

## 2. Канали протоколу v1

Канал ідентифікується парою `(source, key)` у межах Device.

| Capability | source | key | data_type | unit | supports_series |
|---|---|---|---|---|---|
| pressure.read | values | pressure.bar | number | bar | true |
| water_level.read | values | water_level.percent | number | % | true |
| vfd.frequency.read | values | vfd.frequency_hz | number | Hz | true |
| vfd.current.read | values | vfd.current_a | number | A | true |
| vfd.state.read | state | emergency_stop | boolean | null | false |
| vfd.state.read | state | local_mode | boolean | null | false |
| vfd.state.read | state | pump_running | boolean | null | false |
| vfd.state.read | state | vfd_fault_code | integer | null | false |

`vfd.control` не має telemetry-каналів; надає `vfd.start`, `vfd.stop`,
`vfd.frequency.set`. `vfd.state.read` сам по собі не дозволяє керування.

Підтримка описана один раз у `app/device_contract.py`. З нього отримуються
policy ingestion, одиниці series/readings та описи модулів. Старі Python
imports mapping з services залишені сумісними. Проєкція modules не додає
SQL-запит на кожен канал: використовує вже прочитані assignments.

Для графіка `supports_series=true` означає, що ключ підтримується series
endpoint і поточний assignment увімкнений. Це не гарантує наявність історії.
Series повторно перевіряє права й capability; вимкнення між двома запитами
може дати 409. State-канали зараз не мають числового графіка, навіть integer
`vfd_fault_code`; запит їх як series metric повертає 422.

## 3. Показання для UI

Числовий канал використовує `readings`, state-канал — новий `state_readings`.
Кожен state reading має `key`, `value`, `status`:

| Вхідне значення / умова | value | status |
|---|---|---|
| Boolean false/true | Той самий boolean | fresh або stale |
| Цілий vfd_fault_code, включно з 0 | Те саме ціле | fresh або stale |
| Ключ відсутній, null або telemetry ще не надходила | null | missing |
| Неправильний тип, наприклад `"false"` чи 0 замість boolean | null | invalid |
| Boolean/float/string замість integer fault code | null | invalid |
| Integer поза точним діапазоном JavaScript ±(2^53−1) | null | invalid |

Давність state-значень визначається тим самим packet freshness, що й
числових readings: timeout, delayed report, future timestamp, session change.
Свіжий heartbeat не робить старі значення fresh. `false` не замінюється null,
`0` не замінюється false, а invalid/missing не можна показувати як «насос
зупинений» чи «помилок немає». Це відсутність достовірного поточного значення.

Старі `snapshot`, `capabilities`, keys, readings та command arrays збережені.
`snapshot.state` залишається сумісним raw-поданням; для типізованих індикаторів
перший frontend використовує state_readings. GET не переписує БД або історію.
Новий read contract не посилює типізацію MQTT envelope заднім числом:
історичне неправильне значення зберігається, але отримує invalid у UI.

## 4. Права та сумісність

Збережено вимоги `device.read`, `capability.read`, `telemetry.read`.
Viewer бачить підтримувані команди, але всі allowed_commands порожні.
Write API повторно перевіряє permission і capability. `allowed_commands`
не враховує фізичні блокування й не є підтвердженням доставки або виконання.
Tenant isolation, session revocation та `Cache-Control: no-store` збережені.

Нові поля є сумісним розширенням overview. Нових таблиць чи міграцій немає.
Клієнти повинні ігнорувати незнайомі additive response fields.
Актуальна машинна схема — `/openapi.json`.

## 5. Межі та майбутнє

v1 має один фіксований key кожного типу на Device та одну прив'язку
кожної capability. Два незалежні датчики тиску на одному контролері
потребують наступного версійованого контракту instance/channel identity
у firmware, ingestion, історії, rules і UI. Ця операція не оголошує таку
підтримку реалізованою й не генерує фіктивні канали з generic config.

Новий тип обладнання додається до registry разом з handler/policy, тестами
та firmware-контрактом. Саме створення рядка каталогу не є встановленням
нового програмного драйвера. Фізична присутність і справність перевіряються
окремо від адміністративного enabled assignment.

## 6. Докази

H-04 додає 6 unit та 5 PostgreSQL/HTTP тестів. Вони охоплюють типи OpenAPI,
точність цілих для браузера, false/zero/missing/invalid/stale, зв'язок UUID
assignment, невідомі codes, захист config, контроль ролей, відключення та
повторне включення, а також advertised channel → ingestion → series і
advertised command → POST. MQTT publish у вузькому HTTP-тесті замінений Mock;
повний broker/simulator сценарій зберігається в CI та фінальному скрипті.
Live demo також перевіряє новий контракт на різних Device і ролях.
