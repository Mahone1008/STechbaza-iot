# Етап 13.4 — наскрізний інцидент MQTT → browser → recovery

Дата: 28.09.2026. Разом із [13.3 — повідомленнями](stage-13-op3-notifications.md).
База: `e7001d7`. Реалізовано; CI очікується, Windows/manual ще не підтверджено.

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
| TypeScript strict / ESLint / production build | Локально PASS |
| Unit/component | 83 PASS у 15 файлах, включно з 8 notification tests |
| Mocked Chromium | 133 сценарії у 13 файлах; CI очікується |
| Додаткові CI повтори | 34 успадковані + 10 ACK/read 429; очікується |
| Live Chromium + MQTT incident | 10 розширених сценаріїв; CI очікується |
| Python helper / PowerShell wrapper | Python syntax і ASCII-сумісність PASS; виконання Windows очікується |
| Windows/manual 13.3–13.4 | Очікується |

Backend application code, API та migrations не змінюються. Новий повний
backend suite тут не заявляється. Фінальні workflow/head/results будуть
дописані після CI. Прийнятий frontend progress лишається 10/24.

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

## Ручне приймання

- «Повідомлення»: усі/непрочитані, count, сторінки, оновлення, порожній результат.
- Деталі: read лише після кнопки, F5, згортання технічних деталей, перехід до incident.
- Owner/viewer: особисті read_at незалежні; viewer не підтверджує аварії.
- Стара raised-подія зберігається після recovery; нова resolved веде на той самий incident.
- Вузький екран, keyboard, зміна організації/вихід, offline/reconnect без повторного POST.

Наступні операції за roadmap — 14.1 UX/accessibility та 14.2 browser regression.
