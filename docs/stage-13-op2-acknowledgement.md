# Етап 13.2 — підтвердження аварії оператором

Дата: 28.09.2026. Разом із [13.1 — аваріями](stage-13-op1-alarms.md).
Статус: реалізовано; локальні перевірки та фінальний CI фіксуються нижче.
Windows/manual для 13.1–13.2 ще не підтверджено.

## Семантика і доступ

`POST /api/v1/alarms/{id}/acknowledge` означає, що оператор побачив інцидент.
Це не усунення причини, не команда пристрою і не персональне прочитання
notification. Active лишається active, поки backend не зафіксує recovery.
UI не має кнопки примусового resolve.

Кнопка доступна лише з `alarm.acknowledge`, для active/unacknowledged incident,
у видимій online-вкладці після успішного GET. Viewer читає без write control.
Діалог показує пристрій та інцидент і пояснює значення дії. Backend знову
перевіряє права; frontend не вважається authorization boundary.

## Ідемпотентність і гонки

Одна явна дія створює один POST; синхронний guard відсікає подвійний клік.
Автоматичних retries немає, зокрема після 401. F5/reconnect/повернення на
маршрут не повторюють дію; pending intent не записується у storage.

Чинний backend серіалізує acknowledge і resolution через device lock.
Перший actor snapshot зберігається; повторний POST повертає вже підтверджений
incident. Окремого request_id для цього endpoint немає: idempotency визначає
alarm ID та записане підтвердження. Відповідь іншого оператора допустима,
якщо він підтвердив першим; UI не підставляє поточного користувача як автора.

Відповідь POST перевіряється за alarm/device IDs і наявністю acknowledged_at.
Після успіху виконуються нові GET стану та history; optimistic success немає.
`409` при concurrent resolution перечитує стан: resolved без acknowledge
показується як усунена без підтвердження. Уже acknowledged + resolved response
також валідний за чинним backend-контрактом.

Network/timeout/5xx/invalid response залишають невизначений результат.
До нового успішного GET повтор заблокований. Якщо GET підтвердив запис —
показується його справжній автор; якщо incident активний і без acknowledge —
можлива нова явно підтверджена спроба. Для 429 додатково витримується Retry-After,
навіть якщо GET уже виконано. Жоден таймер не надсилає POST.

`401/403/404` приховує дані інциденту й історію до повторної перевірки доступу.
Hidden/offline/logout/unmount скасовують transport. Це припинення очікування,
а не гарантія скасування вже прийнятого сервером підтвердження.

## Перевірки

Локально: OpenAPI verify 0.38.0 / 47 paths, TypeScript strict, ESLint,
**75 unit/component** та production build — PASS.
Фінальний Chromium/CI результат буде додано після завершення workflow.
Backend application code і контракт не змінювалися; backend CI Етапу 12
залишається попереднім доказом, а не новим прогоном цієї операції.

Нові browser tests мають retries=0 та перевіряють confirmation/cancel/double
click, першого автора, 409, втрачену відповідь із записом та без нього,
429, 401/403/404, foreign receipt, F5, offline/reconnect та late response.
Регресії Етапу 12 залишаються в cumulative suite.

### Live-перевірка

`scripts/prepare-stage13-demo.py` виконується всередині demo backend і
перевіряє TECHBAZA_DEMO_MODE, ім’я БД techbaza_demo та UID TB-DEMO-PRESSURE.
Він створює тільки incident `demo.frontend.acknowledgement`; попередній такий
тестовий incident переводить у resolved, зберігаючи історію. Інші аварії,
дані й credentials не видаляються. Це явна тестова fixture через чинний
lifecycle service, а не доказ MQTT rule-engine flow або фізичної аварії.

За opt-in `KERUMO_RUN_ALARM_DEMO=1` live suite перевіряє viewer read-only,
owner POST із браузера, реального автора, active після acknowledge,
transition history та збереження результату після F5. Тести відмовляються
працювати з довільним API: очікують localhost demo та відомий тип fixture.
Нових login-сценаріїв не додано; розширено існуючі live тести.

## Windows: один блок запуску

Зупинити попередній frontend через Ctrl+C; Docker Desktop має працювати.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage13-op1-op2.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 13 verification failed.' }
}
```

Wrapper запускає cumulative 12.3–12.4 gate, готує guarded alarm fixture,
зберігає чинні volumes/credentials, проходить mocked/live suites і запускає
frontend через npm.cmd після PASS. Успадкований live command scenario також
надсилає Stop лише ізольованому TB-DEMO-PUMP simulator.
Python fixture передається у контейнер як UTF-8; wrapper сумісний із
Windows PowerShell 5.1. Локальна перевірка Windows тут не виконується.

## Ручне приймання

1. «Аварії» → пристрій → список: active/resolved, severity, точний тип,
   порожній результат, попередня/наступна сторінки та ручне оновлення.
2. Деталі: окремі статуси, час/лічильник, автор, transitions і згортання
   технічної інформації. Після live suite fixture вже підтверджена owner.
3. На іншому активному demo incident — скасувати, потім підтвердити діалог;
   перевірити автора і те, що acknowledge саме по собі не усуває аварію.
4. Viewer, вузький екран, F5, зміна пристрою та вихід: немає сторонніх даних
   або автоматичного повтору підтвердження.

Прийнятий frontend progress не збільшується без ручного підтвердження.
Наступні операції за планом — 13.3 notifications і 13.4 наскрізний інцидент.
