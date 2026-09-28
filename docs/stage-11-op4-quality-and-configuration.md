# Етап 11.4 — якість даних і зміни конфігурації

Дата: 28.09.2026. Реалізовано разом із [11.3](stage-11-op3-module-widgets.md).
**Статус: локальні перевірки PASS; CI та Windows-приймання очікуються.**

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

CI та точні browser/live результати буде зафіксовано після прогону.
Локальне середовище не має Docker/PowerShell і придатного Chromium;
браузерні та live тести виконуються у GitHub Actions.

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

11.3/11.4 не закриваються до CI та підтвердження користувача; прийнято 10/24.
