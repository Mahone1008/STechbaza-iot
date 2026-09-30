# Етап 13.2 — підтвердження аварії оператором

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Зведений результат 13.1–13.4: [досьє V3.5 — Етап 13](dossier-v3.5-stage-13-alarms-notifications.md).

Дата: 28.09.2026. Разом із [13.1 — аваріями](stage-13-op1-alarms.md).
Статус: реалізовано; повний Frontend checks CI — **PASS: 75 unit / 115 mocked /
10 live + 34 додаткові повтори**.
Windows 28.09.2026 на `b5b400c`: **75 unit / 115 mocked / 10 live — PASS**.
Ручне приймання часткове: список усунених аварій, деталі та історія показані;
решта сценаріїв залишається відкритою.

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
Frontend і live jobs фінального CI завершилися success.
Backend application code і контракт не змінювалися; backend CI Етапу 12
залишається попереднім доказом, а не новим прогоном цієї операції.

Нові browser tests мають retries=0 та перевіряють confirmation/cancel/double
click, першого автора, 409, втрачену відповідь із записом та без нього,
429, 401/403/404, foreign receipt, F5, offline/reconnect та late response.
Регресії Етапу 12 залишаються в cumulative suite.

### CI — 28.09.2026

Code revision:
[`e9c0009`](https://github.com/Mahone1008/STechbaza-iot/commit/e9c0009fec7dcf267df59654484ace19caba6467).
[Frontend checks #36470368112](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36470368112)
— **success**.

| Перевірка | Результат |
|---|---|
| OpenAPI generation / zero diff / verify | PASS; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | 75 PASS, 14 файлів; 7 нових alarm contract tests |
| Mocked Chromium | 115 PASS, 12 файлів; 24 нові alarm scenarios, retries=0 |
| Додаткові повтори | 34 PASS: 10 login + 15 overview + 9 polling; retries=0 |
| Live Chromium | 10 PASS; viewer read-only, owner acknowledge, actor/history/F5 і чинні auth/command/telemetry сценарії |
| Failed / flaky у фінальному прогоні | 0 |
| Windows/manual 13.1–13.2 | Окремі докази та межі приймання наведено нижче |

Frontend job: `109090808224`; live job: `109093365544`.
Guarded fixture всередині demo backend — PASS; Linux live suite — 10/10.
Числа стосуються повних cumulative suites;
попередні 91 mocked сценарії Етапу 12 залишилися зеленими.
Коміт `b5b400c` із фінальними CI-доказами змінює тільки документацію.

### Windows і скриншоти — 28.09.2026

Користувач надав 12 скриншотів запуску та UI після оновлення до
[`b5b400c`](https://github.com/Mahone1008/STechbaza-iot/commit/b5b400c2706b322b10b8ef82622fdf72ef361650).
Виконано `scripts/check-stage13-op1-op2.ps1 -Start` у Windows PowerShell.
Це окремий Windows-прогін cumulative suites; 34 додаткові повтори вище
належать CI й не додаються до Windows-результату.

| Доказ | Що підтверджено |
|---|---|
| `image(20260928-192525).png` | Fast-forward `3c8e489` → `b5b400c`, запуск wrapper 13.1–13.2 |
| `image(20260928-192805).png` | 75 unit/component PASS у 14 файлах, production build та нові alarm routes |
| `image(20260928-193015).png`, `image(20260928-193246).png` | Mocked Chromium: 115 PASS за 3.3 хв; cumulative clean install / API contract / unit / types / build / Chromium gate PASS |
| `image(20260928-193254).png`, `image(20260928-193316).png`, `image(20260928-194221).png` | Docker build; чинні demo-дані й паролі збережено; PostgreSQL, Mosquitto, backend і simulator healthy; ізольовану alarm fixture підготовлено зі збереженням історії |
| `image(20260928-194237).png`, `image(20260928-194247).png` | Live Chromium: 10 PASS за 35.3 с; фінальний gate 13.1–13.2 PASS; Next.js dev server готовий на `http://127.0.0.1:3000` |
| `image(20260928-194513).png`, `image(20260928-194534).png` | Деталі усуненого `device.reboot` на TB-DEMO-PUMP, окремі стани, час/лічильник, системний автор і transitions; розгорнуті та згорнуті деталі, без залишкової порожньої області після згортання |
| `image(20260928-194556).png` | Список аварій TB-DEMO-PUMP із фільтром «Усунені», історичними записами та окремими badges важливості / стану / підтвердження |

«Усунена» разом із «Без підтвердження» — коректний стан: backend зафіксував
recovery без acknowledge оператора. У показаному incident причина переходу —
надходження наступного пакета тієї самої session; кнопки acknowledge для
resolved incident немає за чинними правилами. Історичні записи зберігаються.

Live-тести цього запуску автоматично перевірили owner acknowledge, actor,
active після підтвердження, history/F5 та viewer read-only. Скриншоти ручного
UI показують інший, уже усунений incident; вони не є доказом ручного ACK.
Не показано ручні cancel/confirm на активній аварії, viewer/mobile, F5,
зміну пристрою/вихід, усі фільтри, порожню відповідь і перехід між сторінками.
Прийнятий frontend progress залишається **10/24** до завершення ручного приймання.

У виводі успадкованого `scripts/check-stage10-op2.ps1` виявлено пошкоджене
відображення української підказки після F5. Єдиний не-ASCII рядок UTF-8 script
без BOM замінено ASCII-підказкою `session restored; demo data`, щоб Windows
PowerShell 5.1 не залежав від системної code page. Логіка wrapper не змінена.
Перевірено ASCII-сумісність усього файла й точковий diff. Пізніший Windows
прогін 13.3–13.4 підтвердив читабельність підказки на скриншоті 205445;
докази — у [13.4](stage-13-op4-incident-e2e.md). Вебінтерфейс лишається українським.

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
Windows PowerShell 5.1. Windows-прогін користувача підтверджено скриншотами
вище; у поточному Linux-середовищі PowerShell не запускався.

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
Наступні на момент цієї операції 13.3 notifications і 13.4 наскрізний інцидент
уже реалізовано; їхні результати включено в загальне досьє Етапу 13.
