# Етап 13.4 — наскрізний інцидент MQTT → browser → recovery

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Зведений результат 13.1–13.4: [досьє V3.5 — Етап 13](dossier-v3.5-stage-13-alarms-notifications.md).

Дата: 28.09.2026. Разом із [13.3 — повідомленнями](stage-13-op3-notifications.md).
База: `e7001d7`. Реалізовано; **повний CI — success: 83 unit / 133 mocked /
10 live + 44 повтори PASS**. Windows 28.09.2026: **133 mocked / 10 live /
cumulative gate PASS**; ручне приймання часткове.

## Що перевіряється

Розширено існуючий owner inventory live test — новий owner login не потрібен.
Створюється окремий browser context viewer, щоб перевірити незалежність
прочитання. Загальна кількість live tests лишається 10; зміст одного сценарію
розширено. Власний timeout цього сценарію — 180 с, retries=0.

1. Повернути virtual TB-DEMO-PRESSURE в normal і дочекатися свіжої telemetry
   та відсутності active `demo.pressure.low`.
2. Через `techbaza/demo/scenario` переключити лише pressure simulator у alarm.
   Він надсилає MQTT telemetry з `pressure.bar=0.4`; чинне low rule має threshold
   1.0, clear_threshold 1.5, debounce_samples 2.
3. Дочекатися telemetry → rule Event → active Alarm → raised transition →
   notification. Перевірити зв’язки ID, tenant, source=telemetry, rule_key,
   значення вихідного пакета. Прямого створення цих записів у БД немає.
4. Через browser feed відкрити саме нове notification, звірити count із API,
   позначити прочитаним як owner; перевірити перший read_at після F5.
5. Відкрити пов’язаний incident: він досі active і без acknowledge.
   В окремій viewer session те саме notification досі непрочитане; viewer
   може прочитати його, але не має кнопки acknowledge.
6. Owner підтверджує incident через штатний confirmation dialog. POST 200,
   збережено автора, active залишається active.
7. Через MQTT повернути normal. Після recovery перевірити той самий alarm ID,
   resolved зі збереженим acknowledge, окреме resolved notification і новий
   telemetry message ID. У БД для цього incident рівно два повідомлення:
   raised і resolved; ACK не створює notification.
8. Browser показує resolved + acknowledged, три lifecycle transitions і
   збереженого автора після F5. Старе notification лишається raised/read;
   нове — resolved/unread і веде на той самий incident. Unread filter виключає
   прочитане owner повідомлення та показує нове recovery.
9. `finally` закриває viewer context і повертає demo pressure у normal,
   включно з невдалим browser-сценарієм. Історія інцидентів зберігається.

## Межі тестового середовища

`KERUMO_RUN_NOTIFICATION_DEMO=1` — явний opt-in.
API має бути `http://127.0.0.1:8001`; compose project — тільки
`techbaza-demo` або `techbaza-auth-ci`. Docker викликається аргументами без shell.
Python helper `scripts/stage13-mqtt-scenario.py` виконується у backend container:

- перевіряє TECHBAZA_DEMO_MODE та назву БД techbaza_demo;
- перевіряє фіксовані device/site/assignment IDs та UID TB-DEMO-PRESSURE;
- вимагає enabled pressure capability з початковою PRESSURE_CONFIG;
- при зміненій конфігурації зупиняє тест, нічого не перезаписує;
- приймає тільки normal/alarm для pressure, перевіряє ізольований broker;
- робить лише SQL reads для доказів, scenario надсилає через MQTT;
- має обмежене очікування MQTT publish/ingestion; credentials не друкує.

Це browser E2E з реальними PostgreSQL, Mosquitto, backend та virtual sensor.
Це не перевірка фізичного ESP32/частотника, не load test і не доказ готовності
до 10 000 пристроїв. Команд насосу новий сценарій не надсилає; успадкований
cumulative suite окремо перевіряє Stop ізольованого TB-DEMO-PUMP.

## Виправлення попереднього browser-тесту

Повторний [CI #36475200215](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36475200215)
на `e7001d7` завершився failure: 114 mocked PASS, один 429 ACK test failed;
live job не запускався. Попередній зелений CI та Windows 13.1–13.2 залишаються
історичними доказами й не підмінюють цей результат.

Тест виконував clock.fastForward(11000), поки GET reconciliation міг ще
виконуватися; це могло спрацювати на його 10-секундний timeout. Перед переводом
годинника додано очікування повідомлення про завершений GET. Таке саме
очікування використано для нового notification 429 test. CI повторює обидва
сценарії по п’ять разів без retries; production policy Retry-After не змінена.

## Перевірки

| Перевірка | Стан |
|---|---|
| OpenAPI generation / zero diff / verify | CI PASS; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | Локально та CI PASS |
| Unit/component | 83 PASS у 15 файлах, включно з 8 notification tests |
| Mocked Chromium | 133 PASS у 13 файлах за 3.6 хв; 18 нових notification scenarios |
| Додаткові CI повтори | 44 PASS: 10 login + 15 overview + 9 polling + 10 ACK/read 429; retries=0 |
| Live Chromium + MQTT incident | 10 PASS за 58.3 с; owner/viewer personal read та повний MQTT incident/recovery |
| Failed / flaky у фінальному прогоні | 0 |
| Python helper / PowerShell wrapper | Python syntax і ASCII-сумісність PASS; Windows wrapper та MQTT chain PASS |
| Windows 13.3–13.4 | 133 mocked за 3.9 хв / 10 live за 1.0 хв / cumulative gate PASS |
| Ручне приймання | Стрічка, unread recovery та історія resolved/acknowledged показані; залишок нижче |

Backend application code, API та 17 migrations не змінюються. Новий повний
backend suite тут не заявляється. Прийнятий frontend progress лишається 10/24;
автоматичні докази не закривають непоказані ручні сценарії.

### Фінальні CI-докази — 28.09.2026

Code revision:
[`d7d9f2a`](https://github.com/Mahone1008/STechbaza-iot/commit/d7d9f2a025c57312532c593f9682b0e3d37f5669).
[Frontend checks #36478571392](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36478571392)
завершився **success**; frontend job `109118316921`, live job `109120869889` — success.
Повний run та обидва job перевірено після завершення, а не за проміжним статусом.
Нові notification scenarios, alarm suite, live suite та додаткові повтори
виконуються з retries=0. У фінальних логах немає failed/flaky.

Live log містить PASS для browser MQTT chain та пов’язані записи:

| Доказ | Raised | Recovery |
|---|---|---|
| Alarm ID | `0f739a16-54b2-4270-900b-3d1ccb70dfab` | Той самий ID |
| Тиск із MQTT telemetry | 0.4 bar | 2.484 bar |
| Sequence тієї самої simulator session | 20 | 26 |
| Alarm state / acknowledge | active / false | resolved / true |
| Notification ID | `80f476dd-7bc4-4a88-851f-51a301b8ac1a` | `242f3cf9-83ae-4a21-840c-7a91e59f6b84` |
| MQTT message ID | `7fd771ae-7bae-4123-8bac-48d52a6c851b` | `fe52d3ef-6284-45b2-b9df-eea66318912f` |

Ці IDs належать тимчасовому CI demo, яке штатно прибране після тестів.
Логи зберігають зв’язки telemetry → event → transition → notification.
Browser assertions окремо перевірили незалежні read_at owner/viewer, відсутність
ACK після personal read, active після owner ACK, автора, F5, незмінність
raised snapshot і нове unread recovery. Попередній збій 429 проаналізовано за логами й кодом; небезпечний порядок
тестового годинника виправлено явним очікуванням GET;
обидва 429 сценарії пройшли основний набір і по п’ять додаткових повторів.

Доповнення після CI та фіксація Windows-доказів змінюють лише документацію.

### Windows-докази — 28.09.2026

Переглянуто всі 11 наданих скриншотів із часовими мітками 20:53:06–20:58:55
у назвах файлів. Команду було надано після documentation revision `33fba93`;
точного `git HEAD` у цих кадрах немає, тому окремо підтверджений Windows SHA
не заявляється. Число **83 unit** вище належить перевіреному CI; окремий
підсумок кількості unit tests у цьому наборі скриншотів не показаний.

| Скриншоти | Що підтверджено |
|---|---|
| 205306, 205324, 205343 | 133 mocked Chromium PASS за 3.9 хв, усі 18 notification scenarios; ACK/read 429 tests PASS; cumulative install/API/unit/types/build/Chromium gate PASS |
| 205359, 205418, 205427 | Docker build, міграції та demo seed без показаних помилок; наявні demo-дані й паролі збережено |
| 205445 | Чотири healthy containers, guarded ACK fixture PASS, 10 live PASS за 1.0 хв, явний browser MQTT chain PASS із пов’язаними IDs |
| 205507 | Обидва cumulative wrappers 13.1–13.2 та 13.3–13.4 PASS; frontend на 127.0.0.1:3000 Ready за 493 мс |
| 205712 | Owner feed організації DEMO: клієнт A, фільтр «Усі», unread count 159, raised/read та recovery/unread; session restored |
| 205810 | Recovery snapshot «Причину усунено» досі unread, явна кнопка прочитання, посилання до incident, технічні деталі згорнуті |
| 205855 | Incident resolved + acknowledged, автор DEMO: owner; історія raised → acknowledged → resolved, технічні деталі згорнуті |

Windows MQTT proof належить локальному demo, окремо від CI-доказу вище:

| Доказ | Raised | Recovery |
|---|---|---|
| Alarm ID | `d7b40cbc-b4b6-4638-b5c0-59fcc698d446` | Той самий ID |
| Тиск із MQTT telemetry | 0.4 bar | 2.447 bar |
| Sequence тієї самої simulator session | 22 | 28 |
| Alarm state / acknowledge | active / false | resolved / true |

На UI подія виникла о 20:52:34 UTC, підтверджена о 23:52:39 за часом об’єкта,
усунена о 20:52:43 UTC / 23:52:43 за часом об’єкта. Стрічка явно позначає UTC;
incident використовує timezone об’єкта. Різниця у три години не означає
затримку доставки. Лічильник 159 стосується накопичених непрочитаних
повідомлень організації, а не кількості активних аварій; тест зберігає історію.

У показаних станах явних помилок відображення немає. Кадри підтверджують
наявність збережених результатів, але не самі ручні кліки read/ACK чи F5:
ці записи вже створив live E2E. Автоматичні перевірки personal read,
owner/viewer isolation, F5 та MQTT lifecycle пройдено; ручне приймання
непоказаних взаємодій залишається відкритим.

## Windows: один блок

Docker Desktop має працювати. Зупинити попередній frontend через Ctrl+C.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage13-op3-op4.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 13 verification failed.' }
}
```

Wrapper запускає cumulative 13.1–13.2 gate з notification opt-in і відновлює
попередні environment variables. Volumes/паролі не видаляються. Після PASS
запускається KERUMO; історія містить raised/recovery notification від E2E.

## Залишок ручного приймання

Після наведених скриншотів не підтверджено окремо:

- «Повідомлення»: перемикання усі/непрочитані, зміна count після прочитання,
  сторінки, оновлення, порожній результат.
- Деталі: ручне прочитання кнопкою, збереження після F5, розгортання/згортання
  технічних деталей; сам клік переходу до incident не показаний.
- Owner/viewer: особисті read_at незалежні; viewer не підтверджує аварії.
- Відкриття обох snapshot: стара raised-подія зберігається після recovery,
  нова resolved веде на той самий incident.
- Вузький екран, keyboard, зміна організації/вихід, offline/reconnect без повторного POST.

Наступні операції за roadmap — 14.1 UX/accessibility та 14.2 browser regression.
