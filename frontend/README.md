# KERUMO Frontend

Next.js/React, TypeScript strict, TanStack Query, generated OpenAPI types,
Vitest та Playwright. Реальні API: browser auth, organizations/sites/devices,
телеметрія/історія, команди/журнал, аварії й notifications.
`/ui-kit` та `/ui-kit/device-demo` залишаються позначеними демонстраційними екранами.

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
npm.cmd run test:unit
npm.cmd run build
npm.cmd run check:budget
npm.cmd run test:browser
```

Live suite потребує налаштованого demo. Opt-in сценарії команд/аварій працюють
із guarded simulator fixtures; вони не призначені для physical SU600.
Результати з точними commit наведені в [аудиті](../docs/audit-2026-09-30.md).

## Контракти та поведінка

- Панель типово оновлюється кожні 5 с; варіанти 30/60 с або вручну.
  Історія — 60 с, перша сторінка журналу — 5 с при ввімкненому auto.
  Hidden/offline зупиняє polling, 429 поважає Retry-After.
- При фоновому refresh останні readings залишаються з власною давністю;
  помилка/втрата доступу приховує їх. Історія прибирає старий графік на час
  власного завантаження. [Поточний статус](../docs/project-status.md).
- Access token лише в memory, refresh у HttpOnly cookie; backend перевіряє
  session, tenant і permission на кожному захищеному API-запиті.
- TTL — час першого прийняття команди, не тривалість RUN.
  [Start/Stop/frequency та невідомий результат](../docs/command-safety-v2.md).
- Alarm acknowledge не означає resolve; персональне notification read не є alarm ACK.

OpenAPI: `src/lib/api/openapi.json`, TypeScript: `src/lib/api/schema.d.ts`.
Після зміни DTO виконайте з кореня `python scripts/export_openapi.py`
(потрібні backend dependencies), потім у `frontend` — `npm.cmd run api:generate`.
CI вимагає zero diff. Повний [API contract](../docs/frontend-api-contract-v1.md).
