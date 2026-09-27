# Етап 9, операція 4 — відтворюваний frontend baseline KERUMO

Дата початку: 27.09.2026. Вхідна точка: 9.3 закрито, frontend roadmap 3/24.
Backend залишається **0.38.0**.

**Статус: реалізацію підготовлено до bootstrap CI. Операція 9.4 ще не
закрита; Етап 9 залишається 3/4 до автоматичної та локальної перевірки.**

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
- CI bootstrap, який оновлює tracked package-lock один раз, після чого має
  бути переведений на read-only `npm ci` final gate.

## 3. Перевірки операції

Очікуваний final gate:

```text
npm ci
OpenAPI export + generation + zero diff
npm run api:verify
npm run typecheck
npm run lint
npm run test:unit
npm run build
playwright install chromium
npm run test:browser
```

Browser tests навмисно не виконують login або physical commands. Вони
перевіряють baseline semantics та route rendering. Real auth починається в
10.1, а full demo browser → API → MQTT regression — в 14.2.

## 4. Локальна перевірка

Спочатку зупинити поточний dev server через `Ctrl+C`, потім:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op4.ps1 -Start
```

Перший локальний запуск завантажує Chromium для Playwright і тому може бути
довшим за попередні перевірки.

## 5. Критерії приймання

1. Скрипт завершується `PASS: Stage 9.4...`.
2. Unit/component tests проходять без skipped обов’язкових сценаріїв.
3. Chromium smoke tests проходять для desktop та mobile behavior.
4. Production build стартує через `next start`, а не лише dev server.
5. OpenAPI artifacts current і zero diff.
6. CI використовує tracked lockfile та `npm ci` після bootstrap.
7. Reports не потрапляють у Git; failure зберігає trace/screenshot у CI artifact.
8. Після `-Start` основні routes відкриваються без рухомого Next.js `N`.

Після user acceptance операція 9.4, Етап 9 і frontend foundation будуть
закриті. Roadmap стане **4/24**, наступний крок — **10.1: справжній browser
login email/password за чинним CSRF/cookie contract**.
