# Етап 9, операція 2 — каркас і базові компоненти KERUMO

Дата початку: 27.09.2026. Вхідна точка: операцію 9.1 закрито, frontend roadmap 1/24.
Backend залишається **0.38.0**; ця операція не змінює FastAPI, PostgreSQL або MQTT.

**Статус: автоматичний CI пройдено; реалізацію передано на локальне
користувацьке приймання. Операція 9.2 ще не закрита. Етап 9: 1/4,
frontend roadmap: 1/24 до підтвердження користувача.**

## 1. Мета

Перетворити прийнятий UX-напрямок 9.1 на підтримуваний production-oriented
frontend baseline, не підключаючи завчасно auth/API/business logic операцій 9.3–13.

## 2. Реалізовано

- Next.js App Router;
- TypeScript strict із `noUncheckedIndexedAccess` і `exactOptionalPropertyTypes`;
- окремі layouts для login і workspace;
- responsive sidebar, topbar і mobile bottom navigation;
- design tokens через CSS variables;
- Button, Card, StatusBadge, TextField, SelectField, generic DataTable,
  PageHeader, MetricCard і native accessible ConfirmDialog;
- сторінки login, devices, Device dashboard, alarms і UI kit;
- типізовані demo fixtures, що відрізняють online/stale/offline/new,
  fresh/stale/missing та command ACK/Result semantics;
- `.env.example` без credentials;
- зафіксований `package-lock.json`;
- Node/npm requirements, ESLint flat config і production build scripts;
- PowerShell acceptance script;
- GitHub Actions gate з `npm ci`, typecheck, lint і production build.

## 3. Версії

Офіційний шаблон Next.js **16.3.6** використовує React/React DOM **19.2.8**,
TypeScript `^5`, `@types/node ^20`, `@types/react ^19`, ESLint `^9` і
`eslint-config-next 16.3.6`. Ці межі перенесено до `package.json`; точні
транзитивні версії зафіксовано у `package-lock.json` формату lockfile v3.

Node engine: `>=20.9.0`; CI-версія: **22.16.0**.

## 4. Архітектурні межі

9.2 навмисно не реалізує:

- browser login і session coordinator;
- OpenAPI type generation та API adapter;
- TanStack Query/cache lifecycle;
- live polling;
- реальні Start/Stop/frequency commands;
- alarm acknowledge;
- production CSP/deploy;
- frontend E2E із demo API/MQTT.

Ці функції мають власні операції. Demo buttons відкривають confirmation,
але прямо повідомляють, що HTTP/MQTT команда не створюється.

## 5. Структура

```text
frontend/
  src/app/                 Next.js routes і layouts
  src/components/          shell та reusable UI primitives
  src/features/            devices, alarms, login, ui-kit
  src/lib/demo-data.ts     типізовані fixtures 9.2
  package-lock.json        точний dependency graph
  mockups/stage9-1/        прийнятий історичний UX preview
```

## 6. Автоматичні перевірки

Основна реалізація: commit `827f314efb10d07bab129c9362c4234b811ffb27`.
Перший bootstrap CI — GitHub Actions run **36318246354** — завершився success:
install, TypeScript typecheck, ESLint і Next.js production build пройшли.

Після цього CI окремим службовим commit `2610a741c7acbfc0d44934b9d5aae262c3bdc23a`
зафіксував згенерований `frontend/package-lock.json`. Тимчасове write-право
workflow було прибрано; фінальна перевірка працює з `contents: read`.

Фінальний відтворюваний gate на commit
`7c8a8bb2fb1e3e9546934c87b08470b1379ad9bc`:
GitHub Actions run **36318477330** — `completed / success`.

Пройдено:

1. `npm ci --no-audit --no-fund` за tracked lockfile;
2. `npm run typecheck`;
3. `npm run lint` із zero warnings policy;
4. `npm run build` — Next.js production build.

Це підтверджує збірку й статичну якість каркаса у чистому Linux/Node 22.16.0
environment. Воно не замінює локальне візуальне приймання у Windows.

## 7. Локальна перевірка

У PowerShell з будь-якої папки можна виконати один блок:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op2.ps1 -Start
```

Скрипт перевіряє Node.js, виконує `npm ci`, typecheck, lint, production build,
після чого запускає dev server на `http://127.0.0.1:3000`.

Маршрути для перевірки:

- `/login`;
- `/devices`;
- `/devices/north-pump`;
- `/alarms`;
- `/ui-kit`.

## 8. Критерії користувацького приймання

1. PowerShell-скрипт завершується рядком `PASS: Stage 9.2...`.
2. Усі п’ять маршрутів відкриваються без помилки.
3. Desktop і mobile зберігають hierarchy прийнятої ревізії 9.1.
4. Focus states, labels, touch targets і confirmation dialog зрозумілі.
5. Demo data явно позначені; команди не надсилаються.
6. Код розділений на routes, components, features і data; production source
   не є одним minified HTML-файлом.
7. У bundle/config немає credentials.

Після підтвердження користувача 9.2 закривається, roadmap стає 2/24, а
наступною операцією буде **9.3 — API adapter і контракти**.
