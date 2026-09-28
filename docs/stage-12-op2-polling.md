# Етап 12.2 — єдина політика оновлення

Дата: 28.09.2026. Реалізовано разом із [12.1](stage-12-op1-telemetry-history.md).
**Статус: реалізовано; локальні перевірки та CI — PASS.**
Windows 28.09.2026 — **54 / 63 / 10 PASS** на `c6c215a`.
Залишилися перевірка виправленої прокрутки та окремі ручні сценарії;
прийнятий frontend progress — 10/24.
Додано [збереження фільтрів після F5](stage-12-history-preferences-2026-09-28.md);
CI **61/71/10 + 34 повтори PASS**, деталі наведено в окремому звіті.

## Політика

Одна реалізація `usePanelQuery` та `PollingBudget` обслуговує overview і series.
Користувач обирає 30/60 секунд або «Лише вручну». За замовчуванням overview
оновлюється кожні 30 секунд, одна вибрана series — щонайменше кожні 60 секунд.
Не завантажуються історії всіх каналів або всіх пристроїв.

| Властивість | Поведінка |
|---|---|
| Регулярний бюджет активної вкладки | До 2 overview + 1 series на хвилину після початкового завантаження; відлік після завершення запиту |
| Одночасні запити | До одного на query, до двох для панелі; ручний refresh не запускає дубль |
| Timeout | 10 секунд на HTTP-запит |
| Помилки мережі, timeout, 5xx, 429 | Backoff від базового інтервалу, подвоєння до 300 с + 0–10% jitter |
| Retry-After | Не скорочується backoff cap; враховується і для ручного повтору |
| 401/403/404/409/422/invalid-response | Автоматичні повтори зупиняються; потрібна явна дія або новий контекст |
| Hidden/offline | Polling зупинено, поточні запити скасовано |
| Повернення у visible/online | При увімкненому polling — одне оновлення кожного query без надолуження пропущених tick; чинний backoff збережено |
| Успіх після збою | Лічильник помилок і backoff скидаються |
| Навігація/logout | AbortSignal і session cache cleanup; пізня відповідь не відновлює старий екран |

Звичайний query retry, focus/reconnect refetch вимкнені, щоб не мати кількох
незалежних механізмів повтору. Auth adapter зберігає чинний single-flight refresh
і можливість одного GET replay після нього. Auth/profile-запити, ручні натискання,
зміна фільтрів та повернення у вкладку — окремо від регулярного бюджету.
Кілька видимих вкладок мають власні polling-бюджети; міжвкладковий лідер
для телеметрії в цій операції не реалізований.

Локальний timer якості Етапу 11 продовжує старити показання без мережі.
Пауза або відсутність зв’язку не робить останні показання актуальними.
Push/WebSocket/MQTT у браузері не додаються. Списки залишаються з ручним
оновленням availability, щоб не створювати фоновий fan-out.

## Перевірки

Нові unit/component tests перевіряють повноту series, нулі/пропуски,
чужу identity, units, counts, budgets, діапазони, SVG overflow, backoff,
Retry-After і припинення автоматичних повторів після permanent errors.
Browser suite перевіряє графік/таблицю/mobile, параметри запиту, 403/409/422/503,
invalid response, disable, 30/60 cadence, hidden/manual pause, Retry-After та
пізню відповідь після навігації. Нові browser tests мають retries=0.
Існуючий live inventory scenario розширений реальним telemetry series без
додаткових login спроб, щоб не перевищувати auth rate limit.

Локально: TypeScript, ESLint, **54 unit/component — PASS**; OpenAPI **0.38.0 / 47 paths — PASS**.
Production build — PASS. Перший CI #36437776519: 54 unit PASS,
60 browser PASS / 3 failed, live skipped. Три failures виявили доступні назви
select, що включали текст options: точний `getByLabel` не знаходив поля.
Додано явні aria-label, не послаблюючи перевірки. Ручний dedup також перевіряє
поточний стан QueryClient, щоб два натискання до React render не залишали
ознаку ручного refresh для наступного автоматичного запиту.
Polling/pause regressions додатково повторюються по 3 рази без retries.
Другий CI #36438599787: 62 browser PASS / 1 failed, live skipped.
Останній matcher `toBeDisabled` перевіряв select через вкладений label,
хоча option мав native `disabled`. Перевірка уточнена до
`toHaveJSProperty("disabled", true)` самого option; ліміт 1000 buckets збережено.

### CI початкової реалізації — PASS

[Frontend checks #36439217358](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36439217358)
завершився success для
[`5f2d8a8`](https://github.com/Mahone1008/STechbaza-iot/commit/5f2d8a8c17e9b558f6ef8429612abea0b924ea4b).

| Gate | Результат |
|---|---|
| OpenAPI generation / committed artifacts | Zero-diff; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | **54 passed**, 11 файлів |
| Mocked Chromium | **63 passed**, без failed/flaky |
| Login/refresh navigation | **10 повторів PASS**, retries=0 |
| Overview 403/404/503 recovery | **15 повторів PASS**, retries=0 |
| History polling / Retry-After / offline | **9 повторів PASS**, retries=0 |
| Live Chromium / реальний backend | **10 passed**, без failed/flaky |
| Windows 28.09.2026 (`c6c215a`) | **54 / 63 / 10 PASS**, підтверджено скриншотами |
| Ручне приймання 12.1–12.2 | Графіки підтверджені; прокрутка після виправлення та інші не підтверджені окремо сценарії очікуються |

Jobs: frontend `108985020447`, auth-live `108986653575`.
Live suite справді запитує series API насоса, перевіряє device identity,
time_basis, 60 buckets і таблицю з одиницями API. Ці результати не є
перевіркою фізичного обладнання. Останній documentation commit лише
фіксує результати перевіреної code revision.

Локальне середовище не має Docker/PowerShell і придатного Chromium.
Backend executable code, schema і міграції не змінюються; повний backend suite
для frontend-зміни повторно не запускається.

## Windows-докази та виправлення прокрутки — 28.09.2026

Користувач надав скриншоти повного `check-stage12-op1-op2.ps1 -Start`
після оновлення до `c6c215a`: OpenAPI 0.38.0 / 47 paths, typecheck, lint,
build, **54 unit**, **63 mocked Chromium**, **10 live Chromium** — PASS.
Docker-сервіси healthy; чинні demo credentials/data збережені;
скрипт завершився Stage 12.1–12.2 PASS і запустив frontend.

На екрані насоса підтверджені `pressure.bar` (bar), `vfd.current_a` (A),
`vfd.frequency_hz` (Hz), період 24 години, інтервал 15 хвилин,
Europe/Kyiv, нулі та розриви історії. Режим «Лише вручну» показано.
Скриншоти не доводять окремо всі сценарії F5/mobile/disable/logout/pause.

Користувач повідомив, що зміна метрики, періоду або інтервалу піднімає
сторінку над графіками. Причина: keyed HistoryData замінював графік коротким
loading-повідомленням; overview refresh також замінював віджети повідомленням
і ховав історію через `display:none`. Документ скорочувався, браузер обмежував scrollY.

Виправлення: спільний `StableRegion` вимірює фактичну висоту через ResizeObserver
і зберігає найбільшу висоту результату до виходу з пристрою. Wrapper історії
не перемонтовується при зміні фільтрів. Overview refresh зберігає місце під
віджетами та прихованою історією (`visibility:hidden`, `inert`, `aria-hidden`).
Старі дані недоступні під час оновлення; error/revoke й надалі видаляють їх.
Ручного `scrollTo`, вигаданої сталої висоти або показу старого графіка немає.
У початковому виправленні коротший/порожній результат зберігав попередню
висоту, включно з таблицею, до виходу з пристрою. Подальше
[виправлення згортання](stage-12-details-collapse-2026-09-28.md) додало
скидання резерву до поточної висоти при явному закритті details;
резерв для loading/error збережено.

Додано 4 Chromium-регресії без retries: три фільтри з затриманою відповіддю
на 1280 і 390 px, empty/error після розгорнутої таблиці, overview/series polling.
Перевіряються scrollY під час та після запиту й приховування старих значень.
Локальні OpenAPI/typecheck/lint, **54 unit/component** та build — PASS.
CI виправлення наведено нижче; Windows-скриншоти вище стосуються попередньої revision.

Перший CI виправлення [#36442803717](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36442803717):
54 unit PASS, **66 browser PASS / 1 failed**, live skipped. Три нові сценарії
(фільтри desktop/mobile та polling) пройшли. Четвертий зафіксував зміну scrollY
на 203 px при повторному натисканні після empty. Гіпотезу scroll anchoring
перевірено у [#36443552235](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36443552235):
знову 66/67, той самий тест; відключення anchoring не допомогло й вилучене.
Trace показав збережений резерв 939 px і видиму кнопку перед дією, але
автоматичний `scrollIntoView` усередині Playwright `locator.click()` пересунув
її перед повторним натисканням. Тест використовує реальний pointer click
у центр уже видимої кнопки, попередньо перевіряючи enabled та повну видимість.
Перевірка scrollY (допуск 2 px) та всі перевірки результату залишені без змін.

### Остаточний CI виправлення прокрутки — PASS

[Frontend checks #36444284411](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36444284411)
завершився success для
[`65cf63a`](https://github.com/Mahone1008/STechbaza-iot/commit/65cf63adf385bf32b19d11f0b767240da9063bf8).

| Gate | Результат |
|---|---|
| OpenAPI generation / committed artifacts | Zero-diff; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | **54 passed**, 11 файлів |
| Mocked Chromium | **67 passed**, без failed/flaky |
| Нові scroll-регресії | **4 passed**, retries=0; входять до 67 |
| Login/refresh navigation | **10 повторів PASS**, retries=0 |
| Overview 403/404/503 recovery | **15 повторів PASS**, retries=0 |
| History polling / Retry-After / offline | **9 повторів PASS**, retries=0 |
| Live Chromium / реальний backend | **10 passed**, без failed/flaky |
| Повторна ручна перевірка прокрутки у Windows | Очікується |

Jobs: frontend `109002424918`, auth-live `109004373834`.
Остаточний documentation commit не змінює перевірений frontend/backend code.
Суворий контроль scrollY проходить і під час завантаження, і після заміни
графіка; зміна способу pointer click усунула побічну прокрутку тестового driver.

Для отримання виправлення: зупинити frontend через Ctrl+C, виконати
`git pull --ff-only origin main` у корені, потім `cd frontend` і `npm.cmd run dev`.
Оновити сторінку та перевірити три фільтри, ручний refresh і автооновлення.
Повний Windows check нижче залишається доступним, але його попередній PASS
не видається за перевірку цього виправлення на комп’ютері користувача.

## Windows

Зупинити попередній frontend через Ctrl+C, залишити Docker Desktop запущеним.
Із кореня проєкту:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage12-op1-op2.ps1 -Start
```

Скрипт використовує чинний cumulative check, зберігає demo credentials/data
і після PASS запускає `http://127.0.0.1:3000/login`.

1. Відкрити насос, перевірити метрику/одиницю, період, bucket, графік і таблицю.
2. Порівняти інший пристрій: метрики мають відповідати його модулям.
   Порожня історія законна, якщо simulator не надсилав telemetry.
3. Перевірити «Лише вручну», автоматичне оновлення, приховану вкладку,
   повернення мережі, F5 та вузький екран.
4. Перейти між пристроями/вийти: попередня історія не повинна залишатися.

Реалізація 12.1–12.2 не означає автоматичне закриття ручних сценаріїв 11.3–11.4.
Наступні операції після приймання — 12.3 команди та 12.4 журнал lifecycle.
