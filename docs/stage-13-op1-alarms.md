# Етап 13.1 — реальні аварії та історія інцидентів

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Зведений результат 13.1–13.4: [досьє V3.5 — Етап 13](dossier-v3.5-stage-13-alarms-notifications.md).

Дата: 28.09.2026. Разом із [13.2 — acknowledge](stage-13-op2-acknowledgement.md).
База: [досьє Етапу 12](dossier-v3.5-stage-12-telemetry-commands.md), `9ce22e0`.
Реалізовано; **CI: 75 unit / 115 mocked / 10 live + 34 повтори — PASS**.
Windows 28.09.2026: **75 unit / 115 mocked / 10 live — PASS**.
Список усунених аварій, деталі та згортання історії підтверджено скриншотами.
Докази, Windows-команда та залишок ручного приймання — у 13.2.

## Навігація та межі

`/alarms` більше не показує демонстраційні інциденти або вигадані лічильники.
Сторінка дає вибрати пристрій поточного об’єкта. Об’єкт можна змінити через
наявний каталог; підтверджений site context відновлюється штатним механізмом.
Список пристроїв: 21 запис у запиті, 20 на екрані, попередня/наступна сторінки.
Overview/availability/alarms усіх пристроїв не запитуються.

- `/alarms/devices/{deviceId}` — аварії одного пристрою;
- `/alarms/devices/{deviceId}/{alarmId}` — деталі та lifecycle history;
- на панелі пристрою є permission-aware посилання «Аварії пристрою».

Deep link перевіряє UUID, device → site → organization і права. `alarm.read`
потрібен до рендеру сторінки; backend повторно виконує authorization.
Список і деталі перевіряють `device_id`, деталі — також `alarm_id`, transitions —
батьківський incident та organization автора. Чужа відповідь не рендериться.

## Фільтри та відображення

Список використовує існуючий `GET /api/v1/devices/{id}/alarms`.
Фільтри передаються серверу: active/resolved/усі, warning/critical/усі,
точний `alarm_type` до 96 символів. Тип застосовується кнопкою, без запиту на
кожну клавішу. Зміна фільтра повертає першу сторінку і скасовує старий запит.
Порожня відповідь означає відсутність записів за поточними фільтрами.

Важливість, active/resolved та acknowledged показуються незалежно.
Деталі містять час першого/останнього спрацювання, occurrence_count,
resolved/acknowledged timestamps, автора, ключ/тип та escaped JSON context.
Час показано у timezone об’єкта, з UTC fallback. Довільні типи аварій і модулі
підтримуються без hardcoded переліку датчиків.

`GET /api/v1/alarms/{id}/transitions` показує raised/repeated/acknowledged/
resolved/reopened/severity_changed, from/to state, час, автора, роль,
reason та data. Історія завантажується лише після валідних деталей.

## Пагінація, кеш та помилки

Інциденти й transitions використовують чинний offset API: limit=21,
offset=page×20. Це не snapshot/keyset pagination: вставки та зміни стану
можуть пересунути межі сторінок, про що є пояснення в UI. «Оновити аварії»
повертає першу сторінку; перечитування стану повертає історію на першу.
Frontend не вигадує total або загальний alarm count організації.

Оновлення лише явне, без фонового alarm fan-out. Shared query policy:
timeout 10 с, retry=false, Retry-After для ручного повтору, abort при
hidden/offline/navigation/logout, gcTime=0. Ключі містять user/session,
organization, device, incident, сторінку і фільтри. Auth GET replay після
refresh залишається штатним; POST має окрему політику 13.2.

Loading/error приховує попередні дані, StableRegion зберігає геометрію.
Згортання технічних деталей звільняє місце. `401/403/404` у transitions
приховує також snapshot інциденту й вимагає перевірки доступу. Новий запит
можна зробити вручну; прихована вкладка та offline не запускають мережу.

## Перевірки та залишок

Unit/runtime contract: identity, enums, nullable snapshots, нуль у context,
ліміти/дублікати, фільтри, transitions, malformed deep links.
Mocked Chromium: bounded selection, filters/pages, empty/error/recovery,
foreign rows/details/transitions, revoke, viewer/mobile і escaped content.
Live suite читає реальний demo incident, permissions та append-only history.

Backend executable code, OpenAPI, 47 paths та 17 migrations не змінюються.
Не реалізовано глобальну агрегацію аварій, export, rule editor, push,
персональний notification feed (13.3) або новий наскрізний MQTT-сценарій (13.4).
Windows cumulative gate підтверджено окремо від CI; ручне приймання часткове.
Скриншоти не підтверджують усі фільтри, порожню відповідь і перехід між
сторінками; перелік решти сценаріїв наведено у 13.2.
