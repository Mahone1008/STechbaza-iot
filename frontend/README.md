# KERUMO Frontend

Next.js/React, TypeScript strict, TanStack Query, generated OpenAPI types,
Vitest та Playwright. Реальні API: browser auth, organizations/sites/devices,
телеметрія/історія, команди/журнал, аварії й notifications.
Також реалізовано [особисті акаунти, підтвердження пошти та запрошення](../docs/personal-accounts-v1.md),
добровільний MFA клієнтів, активацію з етикетки, recovery, заводський реєстр і частину
[buyer onboarding](../docs/buyer-onboarding-v1.md); фізичне підключення з телефона ще відкрите.
`/ui-kit` та `/ui-kit/device-demo` є внутрішніми екранами для розробки.
Вони відсутні в навігації та за замовчуванням повертають 404.
Для локального перегляду встановіть `KERUMO_UI_PREVIEW=1` у процесі сервера
Next.js; browser test harness вмикає цей прапорець лише для свого сервера.

Клієнтський інтерфейс показує стан, час, автора й результат дії без сирих JSON,
службових UUID, хешів конфігурації та повідомлень про внутрішню роботу сесії.
Моделі обладнання, версії прошивки, профілі керування й параметри підключення
залишаються доступними. Довгі тире у клієнтських підписах замінено пунктуацією
або коротким дефісом у числових діапазонах; відсутні показники не стають нулями.
Внутрішні дані API, права та правила підтвердження команд не змінено.

[Поточний стан](../docs/project-status.md), [версії з package.json](../docs/generated-code-reference.md),
[історія та залишок приймання](../docs/frontend-roadmap-v1.md).
Етапи 9–14 реалізовано; повністю прийнято 10/24 операцій. Це тестова база.

Таймер і програма частоти відкриваються в додаткових налаштуваннях команд.
[Контракт, оновлення backend/прошивки й перевірка](../docs/control-programs-v1.md).
Самого перезапуску сайту для появи підтримки програм на старій V3 недостатньо.

## Запуск уже налаштованого сайту на Windows

Відкрийте Docker Desktop. У першому терміналі з кореня репозиторію:

```powershell
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml up -d
Invoke-RestMethod http://127.0.0.1:8001/health
```

У другому терміналі:

```powershell
cd frontend
npm.cmd run dev
```

Відкрийте **http://127.0.0.1:3000/login**. Облікові записи й паролі — у
[demo інструкції](../docs/demo-stand-v1.md) та вашому `.env.demo`.
V3 gateway запускається за [окремою інструкцією](../docs/v3-su600-bench.md).
Звичайне відкриття сайту не перепрошиває ESP32.

Для першого встановлення потрібні Node.js 20.9+ (CI 22.16.0), Python,
Docker Desktop/Linux containers. Створіть demo за інструкцією, виконайте
`npm.cmd ci` в `frontend`, скопіюйте `.env.example` у `.env.local`, якщо його немає.
Після зміни backend необхідні його rebuild/міграції; просте `up -d` старий image не оновлює.
Для старого `.env.demo` перед оновленням потрібне
[перенесення account key](../docs/account-key-operations-v1.md).

## Конфігурація й перевірки

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_API_TIMEOUT_MS=10000
```

Використовуйте один host для UI/API: `127.0.0.1` з `127.0.0.1`.
`NEXT_PUBLIC_*` потрапляє в browser bundle; секретам там не місце.
API origin задається до build. HTML/RSC динамічні з per-request nonce,
`no-store`; CSP дозволяє налаштований API origin. Inline styles потрібні React/SVG.

Повний Windows gate з кореня, після завершення фізичного тесту та зупинки
Next.js через `Ctrl+C`:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage14-op3-op4.ps1 -Start
```

Gate оновлює demo, виконує cumulative tests/build/budgets/dependency audit
і запускає зібраний UI. Він може перезапускати backend; не запускайте його
посеред фізичного RUN. Швидкі окремі перевірки з `frontend`:

```powershell
npm.cmd run api:verify
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:budget
npm.cmd run test:browser
npm.cmd audit --audit-level=high
```

Live suite потребує налаштованого demo. Opt-in сценарії команд/аварій працюють
із guarded simulator fixtures; вони не призначені для physical SU600.
Результати з точними commit наведені в [звіті](../docs/audit-2026-10-05-documentation.md).

## Контракти та поведінка

- Картка пристрою має «Панель», «Графіки», «Розклади», «Журнал» та
  «Обладнання». Вибір розділу зберігається в URL; невидимі розділи
  призупиняють polling. Паспорт і технічна діагностика — в «Обладнанні».
  Чернетки живуть при переходах у межах картки, F5 їх не зберігає.
- Панель типово оновлюється кожні 5 с; варіанти 30/60 с або вручну.
  Перша сторінка журналу та вибрана незавершена команда враховують цей самий
  інтервал. Історія телеметрії — не частіше ніж 60 с, відкритий календар —
  30 с, історія запусків — 15 с; повільніший вибір збільшує ці інтервали.
  «Лише вручну» вимикає періодичні запити всіх цих блоків.
  Hidden/offline зупиняє polling, 429 поважає Retry-After.
- При фоновому refresh останні readings залишаються з власною давністю;
  помилка/втрата доступу приховує їх. Фоновий refresh історії зберігає графік
  і стан відкритої таблиці. Після зміни фільтра попередні дані приховані;
  резерв висоти діє лише до відповіді/помилки, без постійної порожньої області.
  [Поточний статус](../docs/project-status.md).
- Access token лише в memory, refresh у HttpOnly cookie; backend перевіряє
  session, tenant і permission на кожному захищеному API-запиті.
- TTL — час першого прийняття команди, не тривалість RUN.
  Поле стоїть перед вибором режиму; у календарі воно стосується кнопкових
  команд (зокрема STOP), тоді як запланований старт має окреме вікно 30 с.
  [Start/Stop/frequency та невідомий результат](../docs/command-safety-v2.md).
- Alarm acknowledge не означає resolve; персональне notification read не є alarm ACK.
- Час можна вводити як `6:00`, `06:00`, `600` або `0600`; API отримує `06:00`.
  Спільні текстові/числові поля й дати показують українські inline-помилки
  незалежно від мови браузера. HTML-валідація зберігає блокування submit.
  Зміни частоти перевіряються всередині одного запуску, послідовно й з
  проміжками від хвилини. [Аудит UX](../docs/audit-2026-10-02-schedule-history.md).
- Поля дати приймають `ДД.ММ.РРРР` або 8 цифр і відкривають спільний
  адаптивний календар. До API надходить ISO-дата; неіснуючі дні та дата
  завершення раніше початку блокують preview. «Сьогодні» визначається
  часовим поясом об'єкта. Escape скасовує вибір і повертає фокус.
- Усі випадаючі списки використовують `SelectField` і спільні CSS-правила.
  У браузерах із `appearance: base-select` відкритий список має ширину поля,
  обмеження розміру екраном і прокрутку; для інших збережено native fallback.
  [Аудит форм і межі перевірки 02.10](../docs/audit-2026-10-02-frontend-forms.md).

OpenAPI: `src/lib/api/openapi.json`, TypeScript: `src/lib/api/schema.d.ts`.
Після зміни DTO виконайте з кореня `python scripts/export_openapi.py`
(потрібні backend dependencies), потім у `frontend` — `npm.cmd run api:generate`.
CI вимагає zero diff. Повний [API contract](../docs/frontend-api-contract-v1.md).

`npm run test:unit` також перевіряє сумісність scoped заміни залежності Next
ESLint, що прибирає вразливий `braces`. [Причина й правила оновлення override](../docs/development-standards.md).
