# Етап 9, операція 4 — відтворюваний frontend baseline KERUMO

Дата початку: 27.09.2026. Вхідна точка: 9.3 закрито, frontend roadmap 3/24.
Backend залишається **0.38.0**.

**Статус: фінальний read-only CI пройдено; операцію передано на локальне
користувацьке приймання. Операція 9.4 ще не закрита. Етап 9: 3/4,
frontend roadmap: 3/24 до підтвердження користувача.**

## 1. Мета

Завершити Етап 9 відтворюваною основою: clean dependency install, перевірений
OpenAPI contract, unit/component tests, production build і початкові browser
smoke tests у реальному Chromium.

## 2. Реалізовано

- Vitest **5.0.2** у Node environment;
- unit/component tests для UI primitives, empty table, labels/validation;
- tests для HTTP status mapping, Retry-After та network/timeout copy;
- Playwright **1.63.0** із Chromium;
- browser smoke для login, fleet, Device dashboard, confirmation dialog,
  API success/network error та mobile navigation;
- `playwright.config.ts` із production `next start`, одним worker і traces
  лише при failure;
- PowerShell acceptance script `scripts/check-stage9-op4.ps1`;
- ignore rules для reports і test artifacts;
- tracked `package-lock.json` із test dependencies;
- read-only GitHub Actions gate із `npm ci` та OpenAPI zero-diff check.

## 3. Автоматичні докази

Основна реалізація 9.4 почалася commit
`b018588149247359d7222d434fbbc51d9558c05c`.

Під час bootstrap CI виявлено й виправлено дві реальні проблеми, без обходу
через `--force` або `--legacy-peer-deps`:

1. Vitest 5 потребує новіші Node type definitions — `@types/node` узгоджено
   з supported range;
2. React static markup зберігав DOM property як `colSpan`, тому тест
   виправлено відповідно до фактичного renderer output.

Після успішного bootstrap GitHub Actions зафіксував exact dependency graph
commit `b269f573c36c3481ca88017c9e3438f10a1b5867`.

Фінальний read-only gate:

- commit `0515f53ba4b5343880a21bc57dc464f2e3f9be90`;
- GitHub Actions run **36325337149**;
- результат `completed / success`;
- workflow permissions: `contents: read`;
- install: `npm ci --no-audit --no-fund` за tracked lockfile.

Пройдено:

1. backend schema dependencies;
2. OpenAPI export 0.38.0;
3. TypeScript contract regeneration і zero diff;
4. `api:verify` — 47 paths;
5. strict TypeScript typecheck;
6. ESLint із zero warnings policy;
7. Vitest — **2 test files, 7 tests, 7 passed**;
8. Next.js 16.3.6 production build — 7 routes;
9. Playwright Chromium — **4 tests, 4 passed**;
10. browser report artifact сформовано окремо від Git.

## 4. Що перевіряють browser smoke tests

- `/login` має зрозумілі email/password labels;
- `/devices` відкривається та веде до конкретного Device;
- Device dashboard явно позначає demo data;
- Start вимагає confirmation і не видає натискання за physical Result;
- API Contract panel відрізняє success від network failure;
- mobile navigation зберігає доступ до основних routes.

Browser tests навмисно не виконують справжній login або physical commands.
Real auth починається в 10.1, а повний browser → API → MQTT regression — у 14.2.

## 5. Локальна перевірка

Спочатку зупинити поточний dev server через `Ctrl+C`, потім:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op4.ps1 -Start
```

Перший локальний запуск завантажує Chromium для Playwright і тому може бути
довшим за попередні перевірки.

Очікуваний фінальний рядок:

```text
PASS: Stage 9.4 clean install, API contract, unit tests, production build and Chromium smoke tests.
```

## 6. Критерії користувацького приймання

1. Скрипт завершується рядком `PASS: Stage 9.4...`.
2. Unit/component tests показують 7 passed без skipped обов’язкових сценаріїв.
3. Chromium smoke показує 4 passed.
4. OpenAPI 0.38.0 / 47 paths і zero diff підтверджені.
5. Production build проходить і сайт запускається після `-Start`.
6. Основні routes відкриваються без рухомого Next.js `N`.
7. Demo screens не видаються за live auth/devices/commands.

Після user acceptance операція 9.4, Етап 9 і frontend foundation будуть
закриті. Roadmap стане **4/24**, наступний крок — **10.1: справжній browser
login email/password за чинним CSRF/cookie contract**.
