# Чисте встановлення та backup/restore v1

Етап 8, операція 6. Backend **0.37.0**, PostgreSQL **16**, міграція
**20260926_0017**. Повний CI та локальне приймання пройдено 26.09.2026:
109 tests без skips, відновлено 20 таблиць і SQLite, live recovery — PASS.
Операцію 6 та Етап 8 закрито; докази — у [журналі](stage-8-test-backend.md).

Поточний сценарій оновлено в H-05 для backend **0.38.0**: **158 tests**,
H-03 preflight перед promotion, без повторного seed наявного demo або
restored copy. Схема 20260926_0017 та принципи ізоляції незмінні.
Статус спільного приймання H-04/H-05 — у [досьє Етапу H](stage-h-backend-corrections.md).

## 1. Що доводить перевірка

Збірка з tracked source запускається на порожніх volumes. Резервна копія
поточного demo відновлюється в іншому порожньому PostgreSQL; порівнюються
схема, кількість і вміст усіх public tables. Відновлений simulator зберігає
стан та журнал виконаних команд. Після цього справжні HTTP/MQTT сценарії
працюють на відновленому стенді.

Це контрольоване приймання локального demo, а не production DR-процедура.
Фізичне обладнання до acceptance broker не підключається.

## 2. Ізоляція та передумови

- Windows PowerShell 5.1 або PowerShell 7, Git, tar, Docker з Linux containers.
- Прийнятий demo з операцій 4–5, його існуючий `.env.demo` та volumes.
- Звичайний project `techbaza-demo`, API `127.0.0.1:8001`.
- Чистий і відновлений projects мають унікальні імена
  `techbaza-accept-<timestamp>-<random>-clean/restore`, власні volumes,
  мережі й brokers. Host ports у них відсутні.
- Перед міграцією/restore перевіряється порожня цільова база.
  SQLite import відмовляється перезаписати існуючий файл.
- Ціль використовує копію environment із backup bundle, а не нові паролі.
- CLI для restore вимагає `TECHBAZA_DEMO_MODE=1`,
  `TECHBAZA_ACCEPTANCE_MODE=1` і для дій з БД — назву `techbaza_demo`.
  Звичайний HTTP startup ці дії не виконує.

Спільний запуск H-04/H-05: [scripts/check-stage-h-final.ps1](../scripts/check-stage-h-final.ps1).
Він використовує [check-stage8-op6.ps1](../scripts/check-stage8-op6.ps1)
як спільну реалізацію. Той самий фінальний сценарій виконує CI PowerShell.

## 3. Послідовність

1. `git archive HEAD`: tracked source експортується в окремий каталог.
   Docker image збирається з цього експорту з `--no-cache`.
2. Новий PostgreSQL проходить усі міграції, строгий regression suite
   **158 tests, zero skips**, seed і живий HTTP/MQTT demo test.
3. Наявний demo коротко зупиняється. Новий image виконує read-only preflight
   його правил/аварій; тільки після PASS image використовується для demo.
   При відмові перевірки відновлюється попередній image. Seed на наявному
   demo не повторюється; користувачі, паролі та модулі збережені.
4. Створюються дві контрольні сутності: активний login та queued STOP
   для тимчасово offline програмного насоса. Вони потрібні, щоб фактично
   перевірити захист від повернення старого доступу й повторної доставки.
5. Backend і simulator джерела зупиняються. За відсутності інших writers
   обчислюється fingerprint БД, копіюється SQLite через backup API,
   `pg_dump --format=custom` створює PostgreSQL archive.
6. Dump копіюється бінарно через `docker compose cp`.
   PowerShell перенаправлення `>` для dump не використовується.
7. Bundle отримує manifest із SHA-256 та розмірами файлів.
   Джерело відразу запускається знову; контрольний login відкликається,
   насос повертається до normal, STOP завершується.
8. В нову порожню ціль імпортується dump через
   `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges`.
   Наявні бази не очищаються; `--clean` не використовується.
9. **До будь-яких змін restore policy** порівнюються всі рядки та схема.
   Перевіряються міграція й існуючі demo credentials, відновлюється SQLite.
10. Застосовується явна recovery policy з розділу 5. Лише після неї
    запускаються цільові backend/simulator.
11. Підтверджуються нові boot sessions зі збереженим command ledger,
    відмова старим tokens, відсутність replay старої команди, повний
    HTTP/MQTT demo test і повторна перевірка canaries.
12. Перевіряється звичайний demo на 8001, записується звіт.
    Видаляються лише тимчасові projects цього запуску та їх volumes.
    Звичайний demo і приватний backup каталог залишаються.

## 4. Що зберігається

Каталог: `backups/acceptance-<timestamp>-<random>/`; `/backups/` у `.gitignore`.

| Файл | Призначення |
|---|---|
| postgres.dump | PostgreSQL custom archive: схема і дані однієї demo БД |
| simulator.sqlite3 | Узгоджена SQLite копія, включно з committed WAL, device state, command ledger і pending replies |
| environment.env | Існуючі demo credentials і JWT secret |
| source.tar | Tracked source перевіреного Git commit |
| source.json | Кількість і SHA-256 усіх рядків кожної public table, fingerprint структури |
| manifest.json | Format version, backend/migration/PostgreSQL version, Git SHA, розміри й хеші п'яти файлів bundle |
| restored.json | Fingerprint цілі до recovery policy |
| restored-simulator.json | Кількість і хеш усіх рядків SQLite devices/commands до запуску simulator |
| restore-guard.json | Кількість відкликаних sessions та ізольованих commands |
| restored-http.json | Фактичні HTTP відмови старим tokens і стан контрольної команди |
| acceptance-report.json | Підсумок перевірки; `status: passed`, Git SHA, версії й результати |

Експортований `source/` використовується як build context. Тимчасові
`canary.json`/`canary-command.json` видаляються після успішного приймання.
При помилці вони можуть залишитися для діагностики.

Bundle містить паролі, JWT secret, персональні дані та історію. Це приватна
резервна копія: її не додають у Git, не публікують як CI artifact і не
надсилають у чат. Для приймання достатньо console PASS та підсумку тестів.
SHA-256 виявляє пошкодження; manifest не є цифровим підписом, шифруванням
або гарантією походження недовіреного dump.

## 5. Безпечний запуск відновленої копії

Відновлення старої БД може повернути login, відкликаний після backup, або
команду, яку source уже виконав. Тому до запуску workers одна транзакція:

| Дані в backup | Дія перед запуском |
|---|---|
| Невідкликані auth sessions | Усі відкликаються; потрібен новий login |
| queued / published commands | `expired`, `restore_delivery_cancelled`; доставка заборонена, історичні ID/TTL/payload/actor збережено |
| acknowledged commands | `result_unknown`, `restore_result_unknown`; автоматичного retry немає, completed_at не встановлюється |
| succeeded / failed / expired / result_unknown | Наявна історія не переписується |
| Auth rate limits | Старі вікна/IP очищаються на ізольованій цілі; наступні входи проходять звичайний limiter |

Створюються відповідні системні аварії/notifications. Повторний запуск
policy не створює дублікати. Помилка створення аварії відкочує всю
транзакцію, включно з sessions і commands. Адаптація після точного restore
навмисна; fingerprint до неї і результат policy зберігаються окремо.

HTTP canary перевіряє старі access/refresh → **401**, новий login працює,
queued STOP залишається expired з **0 publish attempts**, повтор його
request_id не оживляє команду. Перевірка повторюється після live test.

Статус `expired` тут означає скасовану доставку з backup, а не доказ того,
що фізична дія не відбулась до створення копії. Для справжніх пристроїв
потрібні окрема ізоляція, звірення стану й дозвіл оператора на відновлення
керування. Дедуплікація backend сама по собі цього не забезпечує.

## 6. Перевірки та межі

Нові 7 unit tests: пошкодження/відсутність файлу, allowlist manifest,
невірний формат, відмова перезапису, SQLite WAL round-trip, пошкоджена SQLite,
opt-in guard. Нові 4 PostgreSQL tests: round-trip CHECK та виявлення зміни правил/timezone, точність PostgreSQL numeric/JSONB fingerprint, транзакційність, rollback та
ідемпотентність recovery policy зі збереженням terminal history.
Історичний підсумок Етапу 8 — **109 regression tests**.
Після H-01–H-05 набір містить **158 tests**; актуальні докази в досьє Етапу H.

Fingerprint читає всі public tables у read-only REPEATABLE READ, UTC;
порівнює PostgreSQL JSON row text без перетворення чисел на Python float,
columns/defaults/nullability/types,
constraints та indexes. Еквівалентний pg_dump round-trip cast varchar array
до text нормалізується до element casts; дозволені значення й оператори
не вилучаються. Окремий тест доводить, що зміна CHECK і timestamp timezone
все одно змінює fingerprint. Поточна схема використовує UUID keys. Перевірка
не претендує на універсальний аудит extensions, roles, functions, views,
sequences та інших об'єктів довільної PostgreSQL інсталяції.

Це logical backup однієї БД. Cluster roles/ACL не переносяться:
роль і БД створює цільовий Compose. MQTT broker стартує з порожнім станом,
старий broker volume не імпортується. Програмний command ledger simulator
відновлюється окремо. Під час знімка жодні сторонні writers не дозволені.

Не реалізовані цією операцією: автоматичні розклади/retention, encryption,
off-site storage, PITR/WAL archive, виміряні production RPO/RTO,
multi-worker failover, load testing промислового масштабу і hardware-in-loop.
Docker base images/dependencies ще потребують production pinning/SBOM;
clean build перевіряє встановлення commit, а не бітову відтворюваність image.

При помилці блок зупиняється, намагається повернути source demo в роботу,
зберігає backup каталог і прибирає лише власні тимчасові projects.
Невдалий запуск не зараховується як приймання. При HTTP 429 дотримуються
Retry-After; захист входу на звичайному demo не вимикається.

Офіційні описи використаних механізмів:
[pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html),
[SQLite Connection.backup](https://docs.python.org/3.13/library/sqlite3.html#sqlite3.Connection.backup).
