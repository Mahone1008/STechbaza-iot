# Етап 9, операція 2 — каркас і базові компоненти KERUMO

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата початку: 27.09.2026. Backend: **0.38.0**.

**Статус: операцію 9.2 прийнято користувачем і закрито 27.09.2026.
Етап 9: 2/4. Frontend roadmap: 2/24.**

## 1. Результат

Прийнятий UX-напрямок 9.1 перенесено з автономного HTML-макета у
підтримуваний production-oriented frontend baseline:

- Next.js 16.3.6 App Router;
- React / React DOM 19.2.8;
- TypeScript strict із `noUncheckedIndexedAccess` і
  `exactOptionalPropertyTypes`;
- responsive sidebar, topbar і mobile bottom navigation;
- design tokens через CSS variables;
- reusable Button, Card, StatusBadge, TextField, SelectField, DataTable,
  PageHeader, MetricCard і accessible ConfirmDialog;
- окремі routes, components, features і typed demo fixtures;
- login, devices, Device dashboard, alarms і UI kit;
- `.env.example` без credentials;
- tracked `package-lock.json`;
- PowerShell acceptance script та GitHub Actions gate.

## 2. Межі операції

9.2 навмисно не реалізує browser auth, OpenAPI types, API adapter, live
polling, справжні команди, acknowledge аварій або production deployment.
Demo buttons не надсилають HTTP/MQTT і прямо повідомляють про цю межу.

## 3. Автоматичні докази

Фінальний відтворюваний gate на commit
`7c8a8bb2fb1e3e9546934c87b08470b1379ad9bc`:
GitHub Actions run **36318477330** — `completed / success`.

Пройдено:

1. `npm ci --no-audit --no-fund` за tracked lockfile;
2. `npm run typecheck`;
3. `npm run lint` із zero warnings policy;
4. `npm run build` — Next.js production build.

Windows-сумісність npm підтверджено окремим виправленням: PowerShell script
використовує офіційний `npm.cmd`, тому не потребує зміни системної
ExecutionPolicy.

## 4. Локальне приймання користувачем

Користувач виконав перевірку на Windows із:

- Node.js **24.21.0**;
- npm **11.19.0**;
- чистим `npm ci` — 344 packages;
- TypeScript typecheck — PASS;
- ESLint — PASS;
- Next.js 16.3.6 production build — PASS;
- локальним dev server на `http://127.0.0.1:3000`.

Переглянуто й прийнято маршрути:

- `/login`;
- `/devices`;
- `/devices/north-pump`;
- `/alarms`;
- `/ui-kit`.

Надіслані screenshots підтвердили desktop layout, таблицю пристроїв,
Device dashboard, аварії, UI kit, login та рядок:

```text
PASS: Stage 9.2 frontend typecheck, lint and production build.
```

Сірий рухомий значок `N` і меню Route/Bundler є штатним Next.js dev indicator,
а не елементом KERUMO; production build його не показує.

## 5. Вердикт

Критерії 9.2 виконано: код структурований, responsive hierarchy збережено,
компоненти повторно використовуються, credentials відсутні, demo data явно
позначені, а clean install/typecheck/lint/build відтворюються.

**Операцію 9.2 закрито. Наступна операція — 9.3: OpenAPI types, API adapter,
timeout/cancel/error semantics і безпечний query cache lifecycle.**
