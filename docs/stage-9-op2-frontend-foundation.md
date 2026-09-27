# Етап 9, операція 2 — каркас і базові компоненти KERUMO

Дата початку: 27.09.2026. Вхідна точка: операцію 9.1 закрито, frontend roadmap 1/24.
Backend залишається **0.38.0**; ця операція не змінює FastAPI, PostgreSQL або MQTT.

**Статус: реалізацію підготовлено до автоматичної та локальної перевірки.
Операція 9.2 ще не закрита; Етап 9 залишається 1/4 до користувацького приймання.**

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
  fresh/stale/missing і command ACK/Result semantics;
- `.env.example` без credentials;
- Node/npm requirements, ESLint flat config і production build scripts;
- PowerShell acceptance script;
- bootstrap GitHub Actions check для lockfile, typecheck, lint і build.

## 3. Версії

Офіційний шаблон Next.js **16.3.6** використовує React/React DOM **19.2.8**,
TypeScript `^5`, `@types/node ^20`, `@types/react ^19`, ESLint `^9` і
`eslint-config-next 16.3.6`. Ці межі перенесено до `package.json`; точні
транзитивні версії фіксує `package-lock.json`.

Node engine: `>=20.9.0`, перевірочна версія: `22.16.0`.

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
  mockups/stage9-1/        прийнятий історичний UX preview
```

## 6. Перевірки

Автоматичний gate:

```text
npm ci
npm run typecheck
npm run lint
npm run build
```

Локально з кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op2.ps1
```

Для запуску після перевірки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op2.ps1 -Start
```

## 7. Критерії користувацького приймання

1. `npm ci`, typecheck, lint і production build — PASS.
2. `/login`, `/devices`, `/devices/north-pump`, `/alarms`, `/ui-kit` відкриваються.
3. Desktop і mobile зберігають hierarchy прийнятої ревізії 9.1.
4. Focus states, labels, 44px touch targets і dialog працюють зрозуміло.
5. Demo data не виглядають live; команди не надсилаються.
6. Код розділений на routes, components, features і data; немає одного
   minified HTML як production source.
7. У bundle/config немає credentials.

Після підтвердження користувача 9.2 закривається, roadmap стає 2/24, а
наступною операцією буде **9.3 — API adapter і контракти**.
