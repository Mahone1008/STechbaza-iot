# Комплексні перевірки v1 — Етап 8, операція 5

Backend **0.36.0**, міграція **20260926_0017** без змін.
Статус CI та локального приймання: [журнал Етапу 8](stage-8-test-backend.md).

## Мета

Перевірити межі між функціями й відновлення після реального перезапуску
процесів. Окремий успішний endpoint не доводить збереження черги,
ідемпотентність одночасних запитів або узгодженість прав із панеллю.

Операція додає 12 PostgreSQL/HTTP regression tests, доводячи набір до
**98 тестів**, та живий багатофазний fault/recovery сценарій Compose.
Формати API та схема БД не змінюються. Шлях керування demo залишається
HTTP → durable command → MQTT → simulator → ACK/Result → API.

## Матриця нових автоматичних сценаріїв

Код: `backend/tests/test_comprehensive_postgres.py`.

| № | Сценарій | Критерій |
|---|---|---|
| 1 | Два одночасні POST одного request_id | Обидва доходять до відсутнього запису; 201 + 200, один DB record, один publish, один actor |
| 2 | Той самий request_id з іншим payload/user/device | 409 без зміни первинної команди й без команди іншого tenant |
| 3 | Owner через HTTP знижує operator до viewer, потім вимикає membership | Старий JWT одразу бачить нові права; нові commands 403/404, читання після revoke 404 |
| 4 | Owner вимикає vfd.control через HTTP | Панель прибирає commands, новий POST 409, старий audit збережено, після ввімкнення retry не дублює запис |
| 5 | Некоректні UUID/TTL/type/payload/frequency | 422; немає запису в черзі й publish |
| 6 | Anonymous і чужий tenant читають command/event/alarm/notification та намагаються acknowledge/read | 401/404; немає зміни acknowledge або read receipt |
| 7 | Session відкликана після створення команди | Той самий JWT більше не читає і не створює commands; записи не множаться |
| 8 | Перша спроба publish повертає broker failure | Queued збережено; нова DB session повторює той самий envelope; після ACK повторного publish немає |
| 9 | Пристрій offline до завершення TTL | Expired, нуль publish, лише один alarm і raised notification при повторній обробці |
| 10 | Result приходить до ACK, потім повтори й суперечливий Result | Terminal state незмінний; duplicate без побічних дій; конфлікт відхилено |
| 11 | ACK/Result надходить із topic іншого Device UID | Команда не підтверджується і не завершується |
| 12 | Duplicate, нижчий sequence, нова boot session і пакет старої session | Snapshot/аварія не повертаються назад; duplicate не множить notification/історію; унікальні пізні пакети лишаються в графіку за receipt time |

Fixtures мають випадкові UUID й окремі tenants. Cleanup видаляє тільки
створені тестом організації/users та створені ним каталожні capabilities.
Тести запускати із зупиненими workers тієї самої БД. У перевірках
конкретних delivery-переходів підмінено publish; це прямо відокремлено
від живої Compose-перевірки нижче.

## Строгий запуск повного набору

```text
TECHBAZA_RUN_DB_TESTS=1 TECHBAZA_RUN_MQTT_TESTS=1 python -m app.tools.backend_check
```

Потрібні PostgreSQL, broker і застосовані міграції. Runner вимагає обидва
opt-in flags, виконує unittest discover, повертає ненульовий exit code при
failure/error, нульовому наборі або хоча б одному skip. Успіх закінчується:

```text
Ran 98 tests ...
OK
PASS: 98 backend tests, zero skips
```

Той самий runner використовується в обох CI jobs і PowerShell-прийманні.
Звичайний unittest discover лишається доступним для часткової розробки;
його OK зі skipped не зараховується як повне приймання.

## Живе відновлення demo

Код: `backend/app/demo/resilience.py`. Лише TECHBAZA_DEMO_MODE=1,
фіксовані TB-DEMO-* identity, HTTP на внутрішньому backend:8000 та broker
окремого project techbaza-demo. Немає прямого запису тестом до PostgreSQL.

| Фаза | Зовнішня дія | Що перевіряється |
|---|---|---|
| prepare-restart | Simulator переведено в offline через MQTT | API offline/stale, рівно одна активна offline alarm; дві frequency commands queued із TTL 300 і 5 секунд |
| restart backend | Справжній Docker restart backend | Зупинка/запуск процесу з тією самою PostgreSQL та persistent MQTT session |
| verify-restart | Simulator повернено в normal через MQTT | ID/created_at/expires_at збережено; коротка команда expired з 0 publish; довга succeeded; HTTP retry повертає той самий ID; alarm resolved рівно один раз; Start/телеметрія/Stop працюють |
| stop mosquitto | Справжня зупинка broker | HTTP доступний, показання стають stale, device offline, аварія; нова frequency command лишається queued |
| start mosquitto | Справжній запуск broker | Backend/simulator перепідключилися, команда succeeded без зміни ID/TTL, телеметрія fresh, offline alarm resolved, насос зупинено |

Checkpoint `/tmp/techbaza-demo-resilience.json` містить лише IDs, request
body і timestamps. Він переживає restart того самого backend-контейнера;
recreate між фазами не підтримується. Checkpoint не є backup, не містить
credentials і не замінює перевірку збереження команд у PostgreSQL.

Перед цими фазами також повторюються живі сценарії операції 4 і справжній
restart simulator зі звіренням SQLite-журналу, стану та нових boot sessions.
Очікування обмежені timeout; завершення фази не визначається фіксованим sleep.

## Локальне приймання Windows

Після оновлення main виконати [check-stage8-op5.ps1](../scripts/check-stage8-op5.ps1)
у PowerShell. Потрібен збережений `.env.demo` з операції 4.
Сценарій не регенерує credentials, не видаляє volumes і не керує основним
compose.yml на 8000. Demo API після перевірки — **http://127.0.0.1:8001**.

Порядок: зупинка demo workers → build → migration → строгі 98 tests →
seed validation → запуск → живі сценарії → simulator restart → backend
restart з чергою → broker stop/start → quick HTTP → health/compose ps.

Під час fault-фаз повідомлення MQTT disconnect/retry очікувані. Критерій
успіху — всі PASS та фінальна перевірка 0.36.0, а не сама наявність health.
Якщо live-фаза падає, PowerShell намагається повернути demo services та
normal mode, друкує останні logs і зберігає початкову помилку. Це не
зараховується як успіх; повторний запуск відтворює сценарій із початку.

## Що означають результати та межі

- Перевірки підтверджують перелічені сценарії, а не відсутність усіх помилок.
- Відкликання доступу/вимкнення capability блокує наступні HTTP-запити.
  Уже прийнята durable command має власний TTL; поточний протокол не має
  cancel і не обіцяє скасування вже прийнятих команд зміною membership/module.
- Перевірка іншого Device UID доводить backend correlation; криптографічна
  автентифікація самого пристрою потребує production MQTT credentials/ACL/TLS.
- `/health` є liveness, тому під час broker outage може залишатися ok.
  Доступність пристрою, давність даних і queued status показують реальний стан.
- Backup/restore, повна втрата PostgreSQL volume та чиста інсталяція — операція 6.
- Масштаб 10000 контролерів, тривалі load/soak, retention, фізичний VFD та
  firmware після зникнення живлення потребують окремого приймання.
- Browser security перевіряється окремим реальним Chromium job; нові HTTP
  fixtures використовують ASGI з JWT і PostgreSQL, не видаються за browser UI.

## Зафіксоване CI-приймання — 26.09.2026

[Run 36267006983](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36267006983),
код 9b84fa2: обидва jobs success. Hardening — **98 tests in 7.657s**,
Compose demo — **98 tests in 8.064s**, обидва **OK без пропусків**.
Chromium auth, simulator restart, backend restart/queue/TTL,
broker stop/start та фінальна quick HTTP-перевірка — **PASS**.
Повні журнали перевірено; деталі — у журналі Етапу 8.
Локальне приймання користувачем залишається умовою закриття операції 5.
