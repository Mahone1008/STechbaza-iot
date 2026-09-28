# Етап 12.4 — lifecycle і журнал команд

Дата: 28.09.2026. Разом із [12.3 — керуванням](stage-12-op3-command-controls.md).
Статус: реалізацію завершено; результати CI доповнюються після прогону.
Windows і ручне приймання поточної пари ще не підтверджені.

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
