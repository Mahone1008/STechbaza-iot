# Етап 9, операція 4 — відтворюваний frontend baseline KERUMO

Дата початку: 27.09.2026. Дата закриття: 27.09.2026.
Backend залишається **0.38.0**.

**Статус: операцію 9.4 прийнято користувачем і закрито.
Етап 9 завершено 4/4. Frontend roadmap: 4/24.**

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
- проєктне Python `.venv` для OpenAPI export без зміни global Python;
- ignore rules для reports, `.venv` і test artifacts;
- tracked `package-lock.json` із test dependencies;
- read-only GitHub Actions gate із `npm ci` та OpenAPI zero-diff check.

## 3. Автоматичні докази

Основна реалізація 9.4 почалася commit
`b018588149247359d7222d434fbbc51d9558c05c`.

Під час bootstrap CI виявлено й виправлено реальні проблеми без обходу через
`--force` або `--legacy-peer-deps`:

1. Vitest 5 потребував новіші Node type definitions;
2. React static markup зберігав DOM property як `colSpan`, тому assertion
   приведено до фактичного renderer output;
3. Windows не мав backend Python dependencies у global interpreter, тому
   acceptance script створює ізольоване `.venv` і встановлює
   `backend/requirements.txt` туди.

Exact dependency graph зафіксовано службовим commit
`b269f573c36c3481ca88017c9e3438f10a1b5867`.

Фінальний read-only CI gate:

- commit `0515f53ba4b5343880a21bc57dc464f2e3f9be90`;
- GitHub Actions run **36325337149** — `completed / success`;
- workflow permissions: `contents: read`;
- install: `npm ci --no-audit --no-fund` за tracked lockfile.

Після Windows-виправлення окремий GitHub Actions run **36325843460** на commit
`a4ba81ed5d17e3f0d8840cecbd04d67edec0fe0f` також завершився
`completed / success`.

Автоматично пройдено:

1. backend schema dependencies;
2. OpenAPI export **0.38.0**;
3. TypeScript contract regeneration і zero diff;
4. `api:verify` — **47 paths**;
5. strict TypeScript typecheck;
6. ESLint із zero warnings policy;
7. Vitest — **2 test files, 7 tests, 7 passed**;
8. Next.js 16.3.6 production build — **7 routes**;
9. Playwright Chromium — **4 tests, 4 passed**;
10. browser report artifact окремо від Git.

## 4. Що перевіряють browser smoke tests

- `/login` має зрозумілі email/password labels;
- `/devices` відкривається та веде до конкретного Device;
- Device dashboard явно позначає demo data;
- Start вимагає confirmation і не видає натискання за physical Result;
- API Contract panel відрізняє success від network failure;
- mobile navigation зберігає доступ до основних routes.

Browser tests навмисно не виконують справжній login або physical commands.
Real auth починається в 10.1, а повний browser → API → MQTT regression — у 14.2.

## 5. Локальне приймання користувачем

Користувач виконав перевірку на Windows із:

- Node.js **24.21.0**;
- автоматично створеним проєктним `.venv`;
- встановленням backend schema dependencies;
- clean `npm ci`;
- OpenAPI **0.38.0 / 47 paths**;
- TypeScript typecheck і ESLint — PASS;
- Vitest — **7 passed**;
- Next.js production build — PASS;
- локально завантаженим Playwright Chromium;
- Playwright — **4 passed**;
- запущеним KERUMO на `http://127.0.0.1:3000`.

Надіслані screenshots підтвердили фінальний рядок:

```text
PASS: Stage 9.4 clean install, API contract, unit tests, production build and Chromium smoke tests.
```

Також підтверджено відкриття Device dashboard без рухомого Next.js `N`.

## 6. Вердикт

Критерії виконано: clean install відтворюється, OpenAPI artifacts current,
unit/component та Chromium tests проходять, production build збирається,
локальний запуск підтверджено користувачем.

**Операцію 9.4 закрито. Етап 9 завершено 4/4. Frontend roadmap: 4/24.**

Наступна операція — **10.1: справжній browser login email/password за чинним
CSRF, HttpOnly cookie та FastAPI browser-auth contract**.
