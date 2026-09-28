# Етап 12 — згортання технічних деталей без порожньої області

Дата: 28.09.2026. База: `5fa3afe` (12.3–12.4).

## Дефект і причина

На скриншотах `image(20260928-175821).png` і `image(20260928-175852).png`
видно відкриті та згорнуті «Автор і технічні деталі команди». Після згортання
текст зникав, але висота картки залишалася як у відкритого блоку.

`StableRegion` зберігав найбільшу виміряну висоту для захисту від стрибків
сторінки під час loading/error. Він однаково трактував заміну даних і явне
згортання користувачем. Та сама причина стосувалася таблиці вимірювань.

## Виправлення

При закритті наявного `<details>` резерв висоти перевимірюється за поточним
контентом. Native `toggle` обробляється у capture phase, оскільки ця подія
не спливає; миша й клавіатура мають однакову поведінку. Від’єднаний details
не може скинути резерв нового контенту. Listener і ResizeObserver знімаються
при unmount.

Розкриття, loading, error та зміна фільтрів продовжують зберігати потрібний
резерв. Після явного згортання наступні запити використовують уже компактну
висоту. Програмного scrollTo і нових API-запитів не додано.

## Перевірки

Три додаткові Chromium regression tests:

1. Деталі команди, desktop 1280 px: повторне відкриття/закриття мишею й
   Enter, повернення початкової висоти, помилка 503 та ручне відновлення.
2. Той самий сценарій на mobile 390 px.
3. Таблиця вимірювань: закриття прибирає зайву висоту, наступне loading та
   успішне оновлення зберігають компактну висоту і положення сторінки.

Також залишаються чинними попередні регресії зміни метрики/періоду/інтервалу,
порожньої/помилкової історії після відкритої таблиці, auto polling і F5.
[Frontend checks #36462683461](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36462683461)
на коді `dde31a8ac3841cb4f5ab8f32037dd5d10be17f83` — **success**:

| Перевірка | Результат |
|---|---|
| Typecheck, lint, OpenAPI zero diff/verify, production build | PASS |
| Unit | 68 PASS |
| Mocked Chromium | 91 PASS, включно з трьома новими regression tests |
| Додаткові повтори без retries | 34 PASS: 10 login, 15 overview, 9 polling |
| Live Chromium | 10 PASS |
| Failed / flaky у фінальному прогоні | 0 |
| Windows/manual для нового виправлення | Очікується |

Локально також пройшли typecheck, lint, 68 unit і production build.
Backend, API-контракт та Windows scripts не змінювалися.
Наступний коміт документації не змінює перевірений код.

## Windows і ручне приймання попередньої версії

Надані скриншоти 28.09.2026 підтверджують на базі `5fa3afe`:

- усі 88 mocked Chromium сценаріїв пройшли;
- 10 live Chromium tests — PASS;
- cumulative command/lifecycle/journal gate — PASS; frontend dev server Ready;
- ручний Start завершився succeeded з `result.pump_running = true` у simulator;
- доступні actor audit, журнал, Online та свіжа телеметрія;
- частота 800 Гц виходить за межі протоколу, тому «Задати частоту» disabled.

Повного окремого числового підсумку unit на цих скриншотах немає; його
успішність підтверджує завершений cumulative gate. Закриття всіх ручних
сценаріїв етапу й Windows-приймання нового виправлення не оголошуються.

## Оновлення

Зупинити frontend через Ctrl+C. Для встановленого проєкту достатньо
оновлення й перезапуску dev server:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'Update failed; frontend was not started.' }
    Set-Location .\frontend
    npm.cmd run dev
}
```

Відкрити та закрити «Автор і технічні деталі команди»: картка має відразу
зменшитися. Повторити для таблиці вимірювань. Команди пристрою цим
виправленням не змінено. Повний Windows gate, коли він потрібен:
`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage12-op3-op4.ps1 -Start`
із кореня репозиторію.
