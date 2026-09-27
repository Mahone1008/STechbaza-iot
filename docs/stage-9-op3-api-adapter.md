# Етап 9, операція 3 — API adapter і контракти KERUMO

Дата: 27.09.2026. Backend: **0.38.0**.

**Статус: операцію 9.3 прийнято користувачем і закрито 27.09.2026.
Етап 9: 3/4. Frontend roadmap: 3/24.**

## 1. Результат

Створено одну перевірену межу між browser UI та FastAPI, щоб login, списки,
telemetry, commands і alarms не реалізовували власний `fetch`, timeout,
error mapping або cache keys у кожному компоненті.

Реалізовано:

- експорт OpenAPI через `scripts/export_openapi.py` із чинного `app.openapi()`;
- tracked snapshot `frontend/src/lib/api/openapi.json`;
- generated TypeScript contract `schema.d.ts` через `openapi-typescript`;
- перевірку backend version і обов’язкових paths;
- public browser config тільки з `NEXT_PUBLIC_*` без credentials/query/fragment;
- один `apiRequest<T>` із JSON headers, optional Bearer, CSRF, cookie credentials,
  no-store, query params, timeout та AbortSignal;
- normalized `ApiError` для 401/403/404/409/422/429/5xx, network, timeout,
  aborted та invalid response;
- parsing `Retry-After` як seconds або HTTP date;
- TanStack Query із bounded retry policy та `retry: false` для mutations;
- session/tenant/device scoped query keys і cancel + remove cache lifecycle;
- root QueryClient без localStorage persistence;
- real `/health` panel у `/ui-kit` без передчасного підключення devices/auth.

## 2. Зафіксований контракт

- OpenAPI **3.1.0**;
- backend version **0.38.0**;
- **47 paths**;
- `@tanstack/react-query` **5.104.0**;
- `openapi-typescript` **7.13.0**;
- exact dependency graph у `frontend/package-lock.json`.

Devices, alarms, login і Device dashboard залишаються на явних typed demo
fixtures до своїх операцій. Це не маскує їх як live data.

## 3. Автоматичні докази

Основна реалізація: commit
`1924c8a24e5c475b4fff7e20c17a64491284b8ca`.
Generated contract зафіксовано commit
`50e0eebd0f7d010f72685b59e7c49702d440f8de`.

Фінальний read-only gate:

- commit `fd68cd65588a80eff6316ced0aa07f880b6d3ad1`;
- GitHub Actions run **36323956820**;
- результат `completed / success`.

Пройдено:

1. `npm ci` за tracked lockfile;
2. повторний OpenAPI export;
3. regeneration TypeScript contract;
4. zero diff contract check;
5. `api:verify`;
6. TypeScript typecheck;
7. ESLint із zero warnings policy;
8. Next.js production build.

## 4. Локальне приймання користувачем

Користувач виконав Windows-перевірку на Node.js **24.21.0** та надав
screenshots із результатами:

```text
PASS: OpenAPI 0.38.0; 47 paths; generated TypeScript contract present.
PASS: Stage 9.3 OpenAPI contract, typecheck, lint and production build.
```

Після запуску `http://127.0.0.1:3000/ui-kit` реальний health request до
`http://127.0.0.1:8001/health` завершився успішно. UI показав:

```text
API доступний
Backend відповів: ok
service techbaza-backend
version 0.38.0
```

Це підтвердило одночасно:

- правильний API base URL;
- роботу browser request adapter;
- коректне відображення success state;
- відсутність secrets у видимій config;
- доступність backend 0.38.0;
- відсутність рухомого Next.js `N`, вимкненого через `devIndicators: false`.

## 5. Межі

9.3 не реалізує login/session coordinator, live fleet, live Device dashboard,
command writes або alarm acknowledge. Access token поки не зберігається;
memory-only session coordinator створюється на Етапі 10. Автоматичний retry
write-запитів не дозволено.

## 6. Вердикт

Критерії виконано: contract artifacts tracked, clean CI відтворюється,
errors не підміняються empty state, cache має правильний scope, а реальний
`/health` підтверджено у браузері.

**Операцію 9.3 закрито. Наступна операція — 9.4: відтворюваний baseline,
component tests, Chromium browser smoke checks і фінальний CI Етапу 9.**
