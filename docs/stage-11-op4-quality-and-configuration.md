# Етап 11.4 — якість даних і зміни конфігурації

Дата: 28.09.2026. Реалізовано разом із [11.3](stage-11-op3-module-widgets.md).
**Статус: реалізовано; локальні перевірки, CI та Windows — PASS. Залишилися окремі ручні сценарії.**

[Загальне досьє V3.5 — Етап 11](dossier-v3.5-stage-11-inventory-modular-dashboard.md) фіксує всі чотири операції та докази.

## Поведінка

| Стан | Відображення |
|---|---|
| fresh | Валідне значення з позначкою свіжості |
| stale | Останнє відоме значення з явним попередженням, що це не поточний стан |
| missing | Тире та «Немає даних», нуль не підставляється |
| invalid | Тире та «Некоректні дані» |
| session_changed | Пояснення, що показання належать попередній сесії контролера |
| future_timestamp / delayed_report | Окреме пояснення проблеми часу / затримки |
| Online + stale | Незалежні статуси зв’язку й телеметрії |

Один локальний timer оновлює вік даних без мережевих запитів. Враховуються
server received age, затримка reported time та час запиту. Після порога
fresh стає stale; видима вкладка також перевіряє час при поверненні.
Позитивний Online після завершення timeout замінюється вимогою оновити
зв’язок, а не вигаданим підтвердженням Offline. Timer очищується при unmount.

«Оновити панель» атомарно перечитує склад модулів, permissions, presence та
readings через один overview. При disable capability її widgets зникають;
при enable повертаються лише з нової відповіді API. Старий snapshot не може
повернути вимкнений модуль. Під час запиту і після помилки старі показання
приховано. `403/404` показує втрату доступу; `401` проходить чинний механізм
refresh/revoke, без відновлення завершеної browser session.

**Конфігурація в цій операції означає відображення змін призначених модулів,
зроблених через чинний backend API.** Редактор довільного config, provisioning
і write-форма enable/disable не додаються до read-only device dashboard.
Віддалений revoke/config change стає відомим при наступному запиті або
відновленні session. Push і фонове polling — не частина цього етапу.

## Перевірки

Локально пройдено TypeScript strict, ESLint, **42 unit** та production build.
Нові тести охоплюють нулі/false, units, missing/invalid, unsupported,
command-only, дублікати, чужі IDs, невалідні типи, стару сесію контролера,
старіння freshness, disable/enable, помилки/retry, logout, viewer/mobile і
пізню відповідь після зміни маршруту.

Існуючий real-backend inventory test розширено перевіркою overview насоса,
відповідності карток backend capabilities, ручного refresh та переходу на
water-level device з іншим складом модулів і missing reading. Нових login
спроб у suite не додано, щоб не перевищити server rate limit.

Перший CI (`2252148`, run `36432329690`) пройшов 41 unit / 52 mocked / 10 live.
Наступний прогін (`3c70ab0`, run `36432603383`) виявив неоднозначність
`getByRole("alert")`: тест знаходив повідомлення панелі й route announcer
Next.js. Селектор уточнено за heading, без послаблення перевірки приховування
старих показань. Нові overview tests не використовують retries; три сценарії
403/404/503 додатково повторюються по 5 разів у CI. Остаточні результати
наведено нижче.
Локальне середовище не має Docker/PowerShell і придатного Chromium;
браузерні та live тести виконуються у GitHub Actions.

## Остаточні докази CI

[Frontend checks #36433145596](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36433145596)
завершився **success** для code revision
[`bc6c072`](https://github.com/Mahone1008/STechbaza-iot/commit/bc6c0725f7fd0b71dc0a215237e6debd760b90aa).

| Gate | Результат |
|---|---|
| OpenAPI generation | Zero-diff, backend 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | **42 passed** |
| Mocked Chromium | **52 passed**, без failed/flaky |
| Login/refresh navigation, по 5 повторів | **10 passed**, `--retries=0` |
| Overview 403/404/503 recovery, по 5 повторів | **15 passed**, `--retries=0` |
| Live Chromium / справжній backend | **10 passed**, без retries/flaky |
| Windows 28.09.2026 | **42 unit / 52 mocked / 10 live PASS** |
| Ручне приймання 11.3–11.4 | Насос і stale підтверджені; інші сценарії нижче окремо не підтверджені |

Jobs: `frontend` — `108964198855`; `auth-live` — `108965620927`.
Цей documentation commit лише фіксує перевірену code revision. Backend
executable code і міграції не змінено; новий повний backend suite не запускався.
Панель не виконує write requests; enable/disable та session_changed покриті
mocked/контрактними регресіями, реальні modules/missing — live suite.

## Отримані Windows-докази

Скриншоти 28.09.2026 показують pull до `1f5e58c`, спільний скрипт із
`-Start`, 42 unit / 52 mocked / 10 live PASS та запущену панель насоса.
Показано pressure 0 bar, current 0 A, frequency 0 Hz, boolean «Ні» та
error code 0 з явними stale-позначками. Це останні відомі показання.
Порівняння інших пристроїв, F5, вузький екран і logout у двох вкладках
на цій серії зображень окремо не зафіксовані.

## Перевірка у Windows

Зупинити Next.js через `Ctrl+C`, залишити Docker Desktop запущеним:

```powershell
cd "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage11-op3-op4.ps1 -Start
```

Скрипт зберігає demo credentials/data, виконує всі unit/mocked/live suites,
OpenAPI zero-diff та production build. Після PASS відкривається dev server.

1. Увійти й відкрити насос. Перевірити реальні модулі, units і state cards.
2. Перейти до окремого датчика тиску та нового датчика рівня: склад карток
   різний; missing відображається тире. Якщо simulator не запущений,
   stale/Offline законні; для першої телеметрії симулятор потрібен.
3. Оновити панель, натиснути F5, перейти між пристроями — чужі показання
   не повинні залишатися на екрані.
4. Перевірити вузький екран і вихід у двох вкладках.

CI та Windows PASS зафіксовано. До підтвердження решти ручних сценаріїв
11.3/11.4 не закриваються; прийнято 10/24.
