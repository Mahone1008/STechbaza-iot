# Етап 9, операція 3 — API adapter і контракти KERUMO

Дата початку: 27.09.2026. Вхідна точка: 9.2 закрито, frontend roadmap 2/24.
Backend залишається **0.38.0**.

**Статус: автоматичний CI пройдено; реалізацію передано на локальне
користувацьке приймання. Операція 9.3 ще не закрита. Етап 9: 2/4,
frontend roadmap: 2/24 до підтвердження користувача.**

## 1. Мета

Створити одну перевірену межу між browser UI та FastAPI, щоб майбутні login,
списки, telemetry, commands і alarms не реалізовували власний `fetch`, timeout,
error mapping або cache keys у кожному компоненті.

## 2. Реалізований контракт

- OpenAPI snapshot експортується без запуску HTTP server через
  `scripts/export_openapi.py` з чинного `app.openapi()`;
- `openapi-typescript` генерує `schema.d.ts`;
- CI перевіряє backend version і обов’язкові paths;
- browser config читає лише public `NEXT_PUBLIC_*` values і відхиляє URL з
  credentials, query або fragment;
- один `apiRequest<T>` додає JSON headers, optional Bearer, CSRF header,
  `credentials: include`, `cache: no-store`, query params, timeout і cancel;
- errors нормалізуються у `ApiError` без порівняння UI з українським текстом
  backend;
- окремо розрізняються 401, 403, 404, 409, 422, 429, 5xx, network, timeout,
  cancel та invalid JSON;
- `Retry-After` читається як seconds або HTTP date;
- TanStack Query має bounded retry policy; mutations не повторюються
  автоматично;
- query keys завжди містять user/session/tenant/device context;
- session cache можна спочатку cancel, а потім повністю remove;
- root QueryClient не зберігається у localStorage і створюється один раз на
  browser application instance.

## 3. Пакети та generated contract

- `@tanstack/react-query` **5.104.0**;
- `openapi-typescript` **7.13.0**;
- OpenAPI **3.1.0**, backend version **0.38.0**;
- snapshot містить **47 paths**;
- exact dependency graph зафіксовано у `frontend/package-lock.json`;
- `frontend/src/lib/api/openapi.json` і `schema.d.ts` tracked у Git.

## 4. Демонстрація без передчасного підключення бізнес-екранів

`/ui-kit` отримує API Contract panel. Він виконує лише публічний `/health`:

- до першого запиту показує `Не перевірено`, а не порожній список;
- при success показує status, service і backend version;
- при недоступному server показує окремий network error;
- довгий запит можна скасувати;
- reset видаляє лише public health query;
- devices/alarms/login залишаються на явних demo fixtures до своїх етапів.

Це не підміняє Етап 10 auth або Етап 11 live dashboard.

## 5. Безпека й cache policy

- access token у 9.3 не зберігається; майбутній caller передаватиме його з
  memory-only session coordinator;
- refresh cookie не читається JavaScript, але fetch готовий до
  `credentials: include`;
- 401/403/404/409/422/429, cancel та invalid response не retry автоматично;
- network/5xx мають максимум дві додаткові спроби для read queries;
- mutations мають `retry: false`;
- logout або context switch використовуватимуть scoped cancel + remove, тому
  запізніла відповідь старого tenant не повинна потрапити у новий cache;
- write request policy й single-flight refresh реалізуються у наступних
  операціях, а не декларуються готовими зараз.

## 6. Автоматичні докази

Основна реалізація: commit
`1924c8a24e5c475b4fff7e20c17a64491284b8ca`.
Bootstrap GitHub Actions run **36323749392** завершився `success`:

1. встановлено backend schema dependencies;
2. експортовано OpenAPI 0.38.0;
3. встановлено frontend dependencies;
4. згенеровано TypeScript contract;
5. пройдено `api:verify`, typecheck, lint і production build.

Generated contract і lockfile зафіксував службовий commit
`50e0eebd0f7d010f72685b59e7c49702d440f8de`.

Фінальний read-only gate на commit
`fd68cd65588a80eff6316ced0aa07f880b6d3ad1`:
GitHub Actions run **36323956820** — `completed / success`.
Він використовує `npm ci`, повторно експортує OpenAPI, регенерує types,
вимагає zero diff і після цього запускає verify/typecheck/lint/build.

Це доводить відтворюваність contract artifacts у чистому Linux/Node 22.16.0
environment, але не замінює локальну Windows-перевірку UI та реального
`/health` state.

## 7. Локальна перевірка

Спочатку зупинити попередній dev server через `Ctrl+C`, потім:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op3.ps1 -Start
```

Після запуску відкрити:

```text
http://127.0.0.1:3000/ui-kit
```

У development-перегляді Next.js route indicator `N` вимкнено в
`next.config.ts`, бо він не належить до KERUMO. Compile/runtime errors Next.js
продовжує показувати.

## 8. Критерії користувацького приймання

1. Скрипт завершується `PASS: Stage 9.3...`.
2. OpenAPI snapshot і generated types відповідають backend 0.38.0.
3. `/ui-kit` показує API base URL і timeout без secrets.
4. Кнопка перевірки `/health` показує success або зрозумілий network error,
   але не маскує збій як empty data.
5. Cancel не дозволяє старій відповіді змінити очищений стан.
6. Query keys мають session/tenant/device scope; cache не persist-иться.
7. Devices, alarms і login не видаються за live data до відповідних етапів.
8. Сірий рухомий Next.js `N` більше не перекриває інтерфейс.

Після користувацького підтвердження 9.3 буде закрито як 3/24. Наступна
операція — **9.4: відтворюваний baseline, component/browser checks і frontend CI**.
