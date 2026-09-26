# Демонстраційний стенд v1

Стенд створено в Етапі 8, операції 4 (0.35.0). Поточний backend **0.37.0**; міграція залишається
**20260926_0017**. Статус CI і локального приймання — у
[журналі Етапу 8](stage-8-test-backend.md).

## 1. Мета та ізоляція

Стенд дає постійні тестові облікові записи, різний склад модулів,
живу телеметрію, команди й аварії для майбутнього frontend.
Основний локальний стенд на 8000 може працювати паралельно.

| Ресурс | Demo |
|---|---|
| Compose | Окремий compose.demo.yml, project techbaza-demo |
| HTTP API | http://127.0.0.1:8001 |
| Swagger / OpenAPI | /docs та /openapi.json на порту 8001 |
| PostgreSQL | Окрема techbaza_demo, власний volume, без host port |
| MQTT | Окремий broker і volume, без host port |
| Simulator | Окремий контейнер, SQLite volume, без доступу до PostgreSQL |
| Secrets | Випадкові значення у локальному .env.demo, ігнорується Git |

Demo запускається з явним TECHBAZA_DEMO_MODE=1. Seed додатково перевіряє
назву підключеної БД і відмовляється ініціалізувати непорожню базу без
очікуваної demo identity. Початкове створення атомарне та серіалізоване
advisory lock. Повтор зберігає UUID, історію, права, конфігурацію та паролі.
При невідповідності локальних паролів існуючим hash seed зупиняється.
Автоматичного reset/delete/перезапису реальних даних немає.

## 2. Клієнти, ролі та пристрої

Дві організації мають окремі майданчики та tenant isolation.
Всі demo users мають platform_role=user; глобального superadmin немає.

| Обліковий запис | Організація | Роль |
|---|---|---|
| owner@techbaza-demo.example.com | A | owner |
| operator@techbaza-demo.example.com | A | operator |
| viewer@techbaza-demo.example.com | A | viewer |
| other@techbaza-demo.example.com | B | owner |

Паролі різні та випадкові: відповідні DEMO_*_PASSWORD у .env.demo.
Вони не друкуються сценарієм перевірки. Для майбутнього входу прочитати
файл локально; не додавати його до досьє або скриншотів з credentials.
Login/refresh/logout використовують звичайні browser routes, без bypass.

| Ключ / UID | Організація | Модулі та поведінка |
|---|---|---|
| pump / TB-DEMO-PUMP | A | VFD control, frequency, current, state, pressure; Start/Stop/Set Frequency |
| pressure / TB-DEMO-PRESSURE | A | Лише pressure.read; нормальний тиск, low alarm або пропуск |
| stale / TB-DEMO-STALE | A | pressure.read; heartbeat надходить, старий snapshot не оновлюється |
| offline / TB-DEMO-OFFLINE | A | pressure.read; старий snapshot, нових пакетів немає |
| new / TB-DEMO-NEW | A | water_level.read; жодної телеметрії, snapshot null |
| other / TB-DEMO-OTHER | B | pressure.read іншого клієнта, жива телеметрія |

UUID стабільні, утворені UUIDv5 з окремого demo namespace.
Manifest без секретів друкує seed; він також доступний у catalog.py.
Симулятор не приймає довільний реальний Device UID як аргумент запуску.

Два старі snapshot і два історичні пакети створюються seed у його
транзакції з часом 10 хвилин тому. Це явно позначені fixtures для
offline/stale станів. Всі нові живі показання, ACK і Result проходять MQTT
та звичайну backend-обробку. До запуску ще немає довгої історії графіків;
вона накопичується під час роботи.

## 3. Симулятор та надійність

Кожні 3 секунди надходять heartbeat і телеметрія живих пристроїв.
Для stale передається тільки heartbeat. Demo online timeout = 15 секунд,
поріг telemetry freshness = 20 секунд; це локальні настройки стенда.

Симулятор підписується на командний topic лише TB-DEMO-PUMP.
Віртуальні зміни running/frequency і готові ACK/Result записуються в
одну SQLite-транзакцію до publish. Outbox повторює недоставлені відповіді.
Повтор command_id повертає ті самі відповіді без другої зміни стану;
інший envelope з тим самим ID відхиляється. Вже виконаний результат
можна повторити після TTL, але нова прострочена команда не виконується.

SQLite зберігає стан, журнал та outbox між перезапусками. При restart
boot session змінюється, sequence починається знову. File lock не допускає
два одночасні runner-процеси на одному state volume. MQTT callback лише
ставить повідомлення в обмежену чергу; очікування PUBACK виконується
головним потоком. Retained, завеликі та некоректні команди відхиляються.

Це атомарність для програмного симулятора. Фізичну дію VFD неможливо
включити до SQLite-транзакції; production firmware потребує власної
durable deduplication та правил відновлення після зникнення живлення.

## 4. Запуск та повторення перевірки

Для поточного main використовується [check-stage8-op6.ps1](../scripts/check-stage8-op6.ps1):
108 tests без пропусків, чисте встановлення та [backup/restore](backup-restore-v1.md).
Операція 5 на 0.36.0 підтвердила 98 tests і [комплексні recovery сценарії](comprehensive-checks-v1.md);
її PowerShell файл збережено як історичну інструкцію для тієї версії.
Потрібен .env.demo з операції 4; для нового стенду credentials можна створити
командою `python backend/app/demo/config.py --output .env.demo`.

Історичний [check-stage8-op4.ps1](../scripts/check-stage8-op4.ps1) призначений
для коду 0.35.0, прийнятого на afb637f, і виконував:

1. Генерацію відсутнього .env.demo криптографічним RNG; існуючий файл зберігає.
2. Зупинку лише demo backend/simulator, збірку окремого image.
3. Запуск окремих PostgreSQL/MQTT та застосування міграцій.
4. Повний набір **86 unittest tests** з DB/MQTT opt-in.
5. Seed двічі: створення/перевірка повторюваності без скидання даних.
6. Запуск backend/simulator та перевірку через справжній HTTP/MQTT.
7. Restart simulator: звірення журналу команд, стану й нових boot sessions.
8. Повторну HTTP-перевірку після restart і health 0.35.0 на 8001.

Всі команди керування цим стендом мають явний префікс:

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml ps
```

Запуск не видаляє volumes. Щоб зупинити споживання ресурсів:

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml stop
```

Щоб продовжити роботу з накопиченою історією:

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml up -d
```

Основний compose.yml не запускається і не зупиняється цим сценарієм.
Його вже запущений backend може залишатися 0.34.0 на 8000 до окремого
оновлення контейнера; поточний demo backend — 0.37.0 на 8001.

## 5. Ручні сценарії

Команда scenario змінює лише стан віртуального пристрою. Наслідок
надходить до backend наступним MQTT-пакетом; це не прямий запис аварії в БД.

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml exec -T simulator python -m app.demo.simulator scenario pressure alarm
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml exec -T simulator python -m app.demo.simulator scenario pressure normal
```

| Device | Доступні сценарії |
|---|---|
| pressure | normal, alarm, gap, offline |
| pump | normal, fault, offline |
| stale, other | normal, offline |

Alarm: pressure=0.4 bar, спрацювання нижче 1.0 після двох пакетів,
відновлення вище 1.5. Gap: values порожній, показник missing, не 0.
Fault: vfd_fault_code=42, насос зупинений; Start/Set Frequency повертають
failed з demo_vfd_fault, Stop залишається дозволеним.
Offline: припиняються heartbeat/телеметрія; online зміниться після timeout,
а не одразу після CLI. Backend-команди в цей час можуть завершитися TTL.

Для автоматичної перевірки є окремий broker topic techbaza/demo/scenario
з полями device/mode. Він існує лише у demo simulator; production backend
його не обробляє. На host demo broker не опублікований.

## 6. Критерії перевірки

12 додаткових unit tests: opt-in/БД guard, генерація секретів без перезапису,
модульність пакетів, дедуплікація та replay, зміна payload з тим самим ID,
expiry/timezone, restart/outbox, відмова неіснуючим пристроям і сценаріям,
fault/Stop, пропуски, sequence/boot session.

Окремий CI job збирає Docker image і підіймає реальний Compose demo:

- Чотири login через cookie browser flow, logout після перевірки.
- Організації ізольовані, чужий device дає 404, viewer command дає 403.
- Різні capabilities, live/stale/offline/new API стани.
- HTTP command → MQTT → simulator ACK/Result → DB → API/telemetry.
- Повтор request_id повертає ту саму команду; actor role=operator.
- Живий графік, low-pressure alarm, acknowledge, персональне read_at,
  recovery, gap і повернення показань.
- Помилка VFD не видається за succeeded; Stop працює.
- Реальний restart контейнера зберігає simulator state і журнал команд.

Перевірка створює звичайні demo-команди, події та повідомлення. Вони
залишаються для майбутніх екранів. Ролі, модулі та каталожні дані check
не переналаштовує. Наприкінці повертає normal і зупинений demo-насос.
Якщо процес аварійно перервано, сценарій слід відновити/повторити вручну.

## 7. Межі готовності

Це локальний стенд для розробки frontend, а не фізична модель насоса,
випробування 10000 контролерів або production deployment. Числа синтетичні.
MQTT anonymous доступ залишається всередині окремої Docker-мережі;
для зовнішнього розгортання потрібні окремі TLS/ACL/credentials.
Довга історія та SQLite-журнал ростуть під час роботи; retention не додано.
Комплексні відмови системи належать операції 5, приймання чистої установки
і backup/restore — операції 6. Фронтенд — Етап 9.
