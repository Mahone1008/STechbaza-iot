# Етап 12.4 — lifecycle і журнал команд

Дата: 28.09.2026. Разом із [12.3 — керуванням](stage-12-op3-command-controls.md).
Статус: реалізацію завершено, Frontend checks і Backend checks — **PASS**.
Windows-прогін на `5fa3afe` підтверджено: 88 mocked / 10 live та cumulative gate PASS.
Під час ручної перевірки знайдено [дефект згортання деталей](stage-12-details-collapse-2026-09-28.md); повне ручне приймання ще відкрите.

## Lifecycle та аудит

Показано queued → published → acknowledged → succeeded/failed окремо,
а також expired та result_unknown. ACK означає прийом контролером, а не
фізичне виконання. UI показує серверний статус і не переводить команду
в expired за власним годинником.

У деталях є створення, публікація, ACK, завершення, TTL прийому, окремий
result deadline/timeout, payload/result, actor name/email/роль на час запиту,
command/request IDs, спроби й остання помилка публікації, помилка виконання.
Текст і JSON відображаються як escaped React content.

Один вибраний запис перевіряється кожні 5 с до 10 хвилин, лише у видимій
online-вкладці. Відмова/429 використовують спільний PollingBudget із backoff
і Retry-After. У ручному режимі панелі фонового polling немає. Після
succeeded/failed/expired/result_unknown автоматичні перевірки припиняються.
Пізній результат після result_unknown можна отримати ручним GET.
Базове навантаження: ≤12 detail GET/хв + 2 overview GET/хв + 1 series GET/хв;
журнал оновлюється лише вручну. Авторизований GET може додатково повторитися
один раз після refresh токена. Кожне ручне підтвердження додає preflight GET.

## Стабільна пагінація

Сумісне доповнення існуючого
`GET /api/v1/devices/{device_id}/commands`:

| Параметр | Правило |
|---|---|
| `limit`, `offset` | Старі клієнти працюють як раніше |
| `before_created_at` | Дата з часовим поясом, використовується разом із before_id |
| `before_id` | UUID останньої показаної команди |
| cursor + offset | Ненульовий offset із курсором повертає 422 |
| order | created_at DESC, id DESC |

Результат лишається масивом. Наступна сторінка відсікає записи за парою
`(created_at, id) < (cursor timestamp, cursor id)`. UI запитує 21 запис,
показує 20, а зайвий визначає наявність наступної сторінки. Зберігає стек
курсорів для повернення назад. Нові записи не зсувають межу наступної
сторінки. Це не snapshot isolation: серверні зміни статусів видимі при GET.
«Оновити журнал» повертає першу сторінку; автоматичного пересортування немає.

Runtime validation відкидає foreign device/organization, duplicate IDs,
неправильний порядок/курсор і надмірний розмір сторінки. Порівняння зберігає
мікросекунди PostgreSQL. Query keys містять user/session/org/device; змінений
контекст скасовує читання й очищує старі приватні дані штатним auth flow.

Backend зберігає версію 0.38.0: додано сумісні query parameters, без нових
paths або міграцій (47 paths / 17 migrations). OpenAPI JSON та TS оновлено.
PostgreSQL tests перевіряють однакові timestamps, нову вставку між сторінками,
ізоляцію пристроїв, legacy offset; HTTP test — cursor validation.

## Відтворення у Windows

Закрити попередній frontend через Ctrl+C. Docker Desktop має працювати.
Скрипт зберігає існуючі `.env.demo` та volumes, оновлює backend, запускає
окремий demo simulator і проходить cumulative gate з реальним Stop lifecycle.

```powershell
cd C:\Users\seraf\Documents\TechBaza\techbaza-iot
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage12-op3-op4.ps1 -Start
```

На `http://127.0.0.1:3000/login` використовуються попередні demo credentials.
Паролі у документацію/вивід не копіюються.

1. Відкрити **TB-DEMO-PUMP**, перевірити підтвердження Start, частоти й Stop.
   Окремо зіставити прийом, ACK, результат і телеметрію simulator.
2. Перевірити журнал, деталі автора, TTL, попередню/наступну сторінки та
   ручне оновлення після створення нової команди.
3. Viewer бачить журнал без форми керування. На вузькому екрані немає
   горизонтального виходу сторінки; таблиця прокручується у власній області.
4. F5 зберігає вибрані фільтри телеметрії та не повторює команди.
   Зміна метрики/періоду/інтервалу зберігає положення графіків.

## Докази

Локально: typecheck, lint, 68 unit, production build PASS.
Backend без сервісів: 75 PASS, 85 пропущено через відсутність PostgreSQL/MQTT;
це не замінює повний Backend checks CI з нульовою кількістю skips.
Chromium, повний backend та demo lifecycle перевіряються у GitHub Actions.


## Підтверджений CI — 28.09.2026

Frontend code: `bafc98304f12f0339e273aca753dcc7add7eda54`.
[Frontend checks #36458233494](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36458233494) — **success**.

| Перевірка | Результат |
|---|---|
| OpenAPI generation / zero diff / verify | PASS, 0.38.0 / 47 paths |
| Typecheck / lint / production build | PASS |
| Unit | 68 PASS |
| Mocked Chromium | 88 PASS, включно з 17 новими command/journal сценаріями |
| Додаткові повтори без retries | 34 PASS: 10 login + 15 overview + 9 polling |
| Live Chromium | 10 PASS; існуючий inventory test розширено UI Stop → MQTT ACK/result → журналом |
| Flaky/failed tests у фінальному прогоні | 0 |
| Windows-прогін 12.3–12.4 на `5fa3afe` | PASS: 88 mocked / 10 live, cumulative gate; докази у звіті згортання |
| Ручні сценарії користувача | Start/result/audit/журнал показано; знайдено дефект згортання, повне приймання відкрите |

Backend code: `aaeaea7e7ac261a8a6ee9c55eb8a983b0c62c497`.
[Backend checks #36457558266](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36457558266) — **success**:
160 тестів без skips, browser auth, migrations roundtrip, HTTP/MQTT demo,
simulator/backend/broker restart, H-04/H-05, exact backup/restore та safe recovery.
Backend/Compose/backend workflow між цим SHA та frontend SHA не змінювалися.

Перший frontend прогін мав 87 PASS / 1 failure: стара history fixture видаляла
modules, але залишала command_types. Після посилення runtime contract така
відповідь правильно відхиляється. Fixture узгоджено, повний повторний CI зелений.
Записи журналу отримали окреме посилання «Деталі», яке переходить до вибраної
команди й не виглядає як повторне надсилання команди.

Simulator повинен бути у штатному режимі для live execution. Якщо раніше
вручну залишено сценарій offline, його потрібно завершити перед прийманням:

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml exec -T simulator python -m app.demo.simulator scenario pump normal
```

Це змінює лише режим ізольованого demo pump, не видаляє дані чи credentials.
Пізніші коміти з самою документацією не змінюють перевірений код.

Виправлення після Windows-приймання: [згортання деталей і докази](stage-12-details-collapse-2026-09-28.md).

CI виправлення згортання: **68 unit / 91 mocked / 10 live + 34 повтори — PASS**,
[run #36462683461](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36462683461), код `dde31a8`.
