# Виправлення надійності та доступу — 25.09.2026

**Backend:** 0.30.0  
**Міграція:** `20260925_0014`  
**База перевірки:** commit `789fb906761464db07b8eb7b0baa88a675664deb`  
**Статус:** виправлення у `main`; усі 20 автоматичних тестів пройдено в GitHub Actions. 25.09.2026 користувач підтвердив успішну локальну перевірку блоку, включно з PostgreSQL/Mosquitto та HTTP acknowledge.

Це окрема технічна операція перед продовженням Етапу 7. Операцію 6
(Acknowledge) закрито після окремого підтвердження користувачем HTTP-перевірки.
Наступна операція — 7 (Notifications foundation + final E2E).

## 1. MQTT: зберегти повідомлення при помилці БД

**Було.** Обробник перехоплював помилку PostgreSQL і повертав керування.
Paho автоматично надсилав PUBACK, хоча telemetry/ACK/Result не були збережені.

**Зміна.** Увімкнено `manual_ack=True`, `clean_session=False`, сталий
`MQTT_CLIENT_ID`. Успішний commit або відхилення постійно некоректного payload
завершується ACK. Тимчасова помилка не підтверджується. Один керований
network thread виконує reconnect, після якого брокер повторює непідтверджені
повідомлення persistent session. Повтори обробляються наявною ідемпотентною логікою.

Невалідний JSON, порушення протоколу та SQL DataError (наприклад, неможливе
значення JSONB або overflow) відхиляються без нескінченного retry.

**Межі.** Ця гарантія стосується вхідного **QoS 1**. QoS 0 залишається
сумісним для локальних експериментів, але не гарантує відновлення після збою.
Mosquitto повинен зберігати session; volume `mosquitto_data` потрібен для
перезапусків брокера. Один client ID належить одному активному backend.
Горизонтальне масштабування і захищений MQTT transport залишаються окремими задачами.

**Файли:** `backend/app/mqtt_client.py`.

## 2. Команди: актуальний статус після блокування

**Було.** `SELECT FOR UPDATE` міг повернути вже завантажений ORM-об'єкт зі
старим `queued`, навіть коли інша DB session вже записала `succeeded`.

**Зміна.** `CommandRepository.get_for_update()` використовує
`populate_existing=True`. Рішення про publish, ACK, Result або timeout
приймається за станом, повторно прочитаним під блокуванням.

**Файл:** `backend/app/repositories/commands.py`.

## 3. Команди: обмежене очікування Result

**Було.** Після ACK команда залишалася `acknowledged` необмежено довго,
якщо результат не надходив.

**Зміна.** При першому ACK записується `result_deadline_at`. Типовий час —
120 секунд, параметр `COMMAND_RESULT_TIMEOUT_SECONDS` у `.env`/Compose.
Повторний ACK deadline не продовжує. Worker після deadline переводить команду
в `result_unknown`, заповнює `result_timed_out_at` та створює Event/Alarm.
Зміна command і Alarm виконується однією транзакцією.

| Стан | Значення | Повторна публікація |
|---|---|---|
| `queued` | Очікує доставки | За правилами delivery TTL |
| `published` | Передано брокеру, ACK ще немає | Той самий command_id до delivery deadline |
| `acknowledged` | Device прийняв команду, очікуємо Result | Ні |
| `result_unknown` | Result не надійшов вчасно; фізичний результат невідомий | Ні |
| `succeeded` / `failed` | Device надіслав остаточний результат | Ні |
| `expired` | Deadline приймання минув | Ні |

`result_unknown` не означає, що насос зупинений або що виконання не відбулося.
`completed_at` не заповнюється до реального Result. Пізній Result тієї самої
команди приймається, записує `succeeded`/`failed` і закриває саме її Alarm.
Час попереднього timeout зберігається для історії. Повтор Result не створює
нову подію. Це аварійний запис у backend, а не вже реалізоване push-повідомлення.

**Міграція 0014:** два nullable timestamp-поля та індекс. Історичні
`acknowledged` отримують deadline = попередній ACK (або publish/creation)
+ 120 секунд. Тому давно завислі команди після запуску worker можуть одразу
перейти в `result_unknown`. Записи не видаляються.

**Файли:** model/schema command, command ACK/Result/dispatch/repository,
`services/command_config.py`, `services/system_alarms.py`, migration 0014.

## 4. Alarm rules: помилки відхиляються до збереження

**Було.** Різні capabilities одного Device могли містити однаковий активний
`rule_key`. Конфлікт виявлявся під час telemetry ingestion і відкочував пакет.
Пороги `NaN`/`Infinity` також проходили валідацію.

**Зміна.** Створення/оновлення assignment бере Device lock, перевіряє
унікальність ключів серед активних правил усіх enabled capabilities і
повертає **409** при конфлікті. Цей самий Device lock використовує ingestion.
Заборонено нечислові нескінченні пороги, включно з рядками `"NaN"` та
`"Infinity"`: API повертає **422**. Вимкнення assignment залишається доступним.

Зміни захищають нові API-записи. Вже внесені раніше некоректні конфігурації
потрібно виправити через PATCH; прихованої автоматичної зміни правил немає.

**Файли:** `schemas/alarm_rule.py`, `services/capabilities.py`,
`repositories/devices.py`, `api/v1/capabilities.py`.

## 5. Глобальна діагностика: доступ лише superadmin

**Було.** `/mqtt/last` та споріднені маршрути повертали останні дані різних
tenant без авторизації.

**Зміна.** `/mqtt/*`, `/command/reliability/status`, `/system/alarms/status`,
`/health/db` і `/health/mqtt` вимагають чинну session і platform role
`superadmin`. Без token — **401**; tenant owner/admin та platform
`service_admin` — **403**. Їхні tenant permissions не дають глобального доступу.
Короткий `/health` залишається публічним і повертає версію/стан сервісу.
Звичайні tenant API продовжують використовувати чинні RBAC guards.

Старі інструкції, які викликають глобальну діагностику без token, після
цього виправлення мають очікувати 401. Не потрібно підвищувати роль звичайного
користувача, щоб запустити автоматичні тести.

**Файли:** `security/diagnostics.py`, `app/main.py`.

## 6. Membership: останній owner і конкурентні зміни

**Було.** Два запити могли одночасно побачити двох owner і видалити обидві ролі.

**Зміна.** Усі create/update membership беруть спільний Organization lock
до читання ролей і підрахунку owner. Дані membership перечитуються, а право
адміністрування повторно перевіряється після очікування блокування.
Видалення останнього owner повертає **409**, відкликані права — **403**.

**Файли:** `repositories/memberships.py`, `services/memberships.py`,
`api/v1/memberships.py`.

## 7. Перевірки і межі доказів

Додано `backend/tests/` та workflow `.github/workflows/backend-checks.yml`.

| Перевірка | Підтверджений стан |
|---|---|
| Регресії handlers, правил, команд, доступу | Пройдено у середовищі розробки |
| TCP reconnect і повтор непідтвердженого packet з тестовим MQTT peer | Пройдено |
| Alembic: один head 0014 і генерація PostgreSQL SQL | Пройдено |
| Одночасна зміна owner на справжній PostgreSQL | Пройдено в GitHub Actions |
| Одночасне призначення конфліктних rules на PostgreSQL | Пройдено в GitHub Actions |
| Timeout + Alarm + late Result на PostgreSQL | Пройдено в GitHub Actions |
| Повторна доставка Mosquitto після штучного збою DB processing | Пройдено в GitHub Actions |
| Оновлення на комп'ютері користувача | Підтверджено скриншотами: main ba60a03, migration 0014, backend 0.30.0 |
| Локальні регресії, PostgreSQL/MQTT та HTTP acknowledge | Користувач підтвердив успішне виконання блоку 25.09.2026 |
| Перевірка цих виправлень на живому ESP32/VFD | Ще не виконано |

Локальний швидкий набір: **15 tests passed**, 5 інтеграційних tests пропущено
без явного opt-in. Перевірка ORM на SQLite не підміняє PostgreSQL concurrency.
Workflow використовує Python 3.13, PostgreSQL 16 та Mosquitto 2 у тимчасовому
оточенні, застосовує всі міграції і запускає повний набір.

PostgreSQL-тести створюють окремий tenant з випадковим UUID та видаляють лише
власні тестові записи. Вони використовують commit, бо перевіряють кілька
одночасних DB sessions. При примусовому завершенні процесу можуть залишитися
тестові записи `Hardening check`; звичайне завершення прибирає їх.

### Результат GitHub Actions

[Backend checks — успішний запуск 36137783823](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36137783823),
commit `2109782da5d7d383aa518dc590023e3882957abb`.

- Python 3.13, PostgreSQL 16, Mosquitto 2.
- Усі міграції від порожньої бази до `20260925_0014` застосовано успішно.
- **Ran 20 tests — OK**, без пропущених тестів у CI.
- Підтверджено, що два одночасні пониження owner залишають одного owner.
- Підтверджено, що два одночасні призначення конфліктного rule дають один
  успіх і один конфлікт.
- Підтверджено `result_unknown` + Alarm і приймання пізнього Result у PostgreSQL.
- Mosquitto повторно доставив QoS 1 packet після штучної помилки DB processing;
  пакет після reconnect збережено у PostgreSQL.

Перший запуск CI зупинився до тестів через лапки в Docker healthcheck.
Конфігурацію виправлено окремим комітом, повторний запуск завершився успішно.
Це не перевірка живого ESP32/частотника або локальної бази користувача.

### Локальний результат — 25.09.2026

Скриншотами підтверджено оновлення `main` до `ba60a03`, успішну Docker
збірку, перехід `20260925_0013 → 20260925_0014 (head)` та
`GET /health → status=ok, version=0.30.0`.

Користувач повідомив про успішне виконання наступного блоку перевірок:
швидкий набір (очікуваний підсумок `OK (skipped=5)`), усі п'ять
PostgreSQL/MQTT-перевірок (`OK` без пропусків), `alarm_ack_http_check`
(три `PASS`) та повторний запуск backend з відповіддю `ok / 0.30.0`.
Повні логи цих тестів у чаті не надано; джерело локального результату —
підтвердження користувача. Результат GitHub Actions вище перевірено за логами.

На час інтеграційних тестів основний backend зупиняється, щоб його
фонові command workers і MQTT-підписки не втручалися в тестові сценарії.

## 8. Оновлення локально — виконувати поетапно

Спочатку перевірити локальні зміни й поточну гілку:

```powershell
git status --short
git branch --show-current
git log -1 --oneline
```

Після перевірки результату — отримати код, зупинити старий backend і
застосувати міграцію **до запуску нового backend**:

```powershell
git pull --ff-only
docker compose stop backend
docker compose build backend
docker compose run --rm backend alembic upgrade head
docker compose up -d backend
```

Наступний контроль:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
docker compose exec -T backend alembic current
```

Очікується backend `0.30.0` і revision `20260925_0014 (head)`.

Швидкі регресії:

```powershell
docker compose exec -T backend python -m unittest discover -s tests -v
```

PostgreSQL/MQTT-перевірки: спочатку зупинити основний backend, потім
запустити окремий тимчасовий контейнер. PostgreSQL і Mosquitto залишаються
запущеними. Очікується `Ran 5 tests — OK` без пропусків.

```powershell
docker compose stop backend
docker compose run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -p test_hardening_postgres.py -v
```

MQTT+DB сценарій має власний client ID та окремі test Device topics.
Основний backend під час тесту зупинено, бо його загальна MQTT-підписка
також могла б отримати тестову telemetry.

HTTP acknowledge та запуск після успішних тестів:

```powershell
docker compose run --rm -T backend python -m app.tools.alarm_ack_http_check
docker compose up -d backend
Invoke-RestMethod http://127.0.0.1:8000/health
```

При `FAILED` спочатку розібрати помилку. Штучний збій MQTT усередині
сценарію очікуваний; підсумок цього тесту має бути `OK`.

## 9. Точка продовження

1. Локальне оновлення та перевірки виправлень підтверджено користувачем.
2. Етап 7 → Операцію 6 закрито після підтвердження `alarm_ack_http_check`.
3. Наступний блок — Операція 7: Notifications foundation + final E2E.

Погоджений формат роботи: пояснення → блок кількох пов'язаних дій і
перевірок → результат користувача → запис результату → наступний блок.
Користувач може надіслати вивід/скриншот або сказати «є» / «есть», що
означає виконання з очікуваним результатом. При помилці потрібен її текст
або скриншот. Зміни виконуються безпосередньо в `main`, без нових гілок.
