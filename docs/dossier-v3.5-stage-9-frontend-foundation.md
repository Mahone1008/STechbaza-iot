# Досьє V3.5 — Етап 9

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

## Frontend Foundation KERUMO — загальне підсумкове досьє

Дата початку: 27.09.2026.  
Дата завершення: 27.09.2026.  
Backend base: **0.38.0**.  
Frontend roadmap після завершення: **4/24**.

> **Статус: Етап 9 завершено 4/4 і прийнято користувачем.**
>
> Наступна операція: **10.1 — справжній browser login через email і пароль**.

---

## 1. Призначення етапу

До Етапу 9 проєкт уже мав прийнятий backend із telemetry, command ACK/Result,
browser-auth contract, RBAC, аваріями, notifications, demo-стендом і повною
серверною регресією. Водночас робочого frontend-застосунку ще не існувало:
були лише попередні візуальні прототипи та API-контракти.

Мета Етапу 9 — не підключити одразу всі бізнес-функції, а створити
**професійну, підтримувану та відтворювану frontend-основу**, на якій без
хаотичного переписування можна реалізувати:

- вхід і сесії;
- організації, об’єкти та пристрої;
- модульну панель контролера;
- графіки telemetry;
- команди Start/Stop/frequency;
- аварії, події та notifications;
- desktop і mobile роботу;
- автоматичні browser-регресії.

Етап завершено без зміни прийнятого backend 0.38.0 і без масового
перейменування внутрішніх TechBaza identifiers.

---

## 2. Підсумок операцій

| Операція | Результат | Статус |
|---|---|---|
| **9.1 — UX-сценарії та макети** | Погоджено KERUMO light industrial SaaS direction, карту сторінок, ролі, desktop/mobile hierarchy, стани даних і команд | Закрито |
| **9.2 — Каркас і компоненти** | Створено Next.js/React/TypeScript strict застосунок, design tokens, responsive shell і reusable UI primitives | Закрито |
| **9.3 — API adapter і контракти** | Додано OpenAPI snapshot, generated TypeScript contract, shared API client, normalized errors і TanStack Query policy | Закрито |
| **9.4 — Відтворюваний baseline** | Додано clean install, unit/component tests, Playwright Chromium smoke, production build, CI і Windows acceptance | Закрито |

Детальні досьє:

- [9.1 — UX-сценарії та макети](stage-9-op1-ux-and-mockups.md);
- [9.2 — frontend foundation](stage-9-op2-frontend-foundation.md);
- [9.3 — API adapter і контракти](stage-9-op3-api-adapter.md);
- [9.4 — відтворюваний frontend baseline](stage-9-op4-frontend-baseline.md).

---

## 3. Що змінилося після Етапу 9

### До етапу

```text
FastAPI backend 0.38.0
PostgreSQL + MQTT + simulator
API contracts і demo data
        ↓
немає підтримуваного web UI
```

### Після етапу

```text
KERUMO Next.js application
        ↓
Design system + responsive shell
        ↓
Shared API adapter + generated OpenAPI types
        ↓
TanStack Query cache policy
        ↓
FastAPI backend 0.38.0
        ↓
PostgreSQL / MQTT / simulator
```

Зовнішній UI уже використовує бренд **KERUMO**, але внутрішні identifiers
`techbaza/...`, Python packages, database migrations і Docker service names
поки збережені для сумісності. Їх косметичне перейменування не було умовою
готовності frontend foundation.

---

## 4. Прийнятий UX-напрямок

Першу надмірно темну й контрастну концепцію було відхилено. Після ревізії
прийнято спокійний **light industrial SaaS interface**.

Основні правила:

- світлий нейтральний фон;
- білі робочі surfaces із тонкими межами;
- бірюзовий лише як brand і primary-action accent;
- green/yellow/red лише для semantic states;
- telemetry відокремлена від критичних write-actions;
- organization → site → device context завжди видимий;
- mobile layout не є простим зменшенням desktop;
- color ніколи не є єдиним носієм status;
- online, fresh data, ACK і physical Result не змішуються в один стан.

### Інформаційна hierarchy Device dashboard

1. Організація, об’єкт і конкретний Device.
2. Online/offline і last seen.
3. Локальний або дистанційний режим.
4. Якість і давність telemetry.
5. Ключові показники.
6. Графік.
7. Окрема control panel.
8. Активні попередження.
9. Встановлені модулі.
10. Lifecycle останньої команди.

Це дозволяє оператору спочатку зрозуміти фактичний стан, а вже потім
переходити до дії.

---

## 5. Зафіксований технологічний стек

| Компонент | Версія / рішення |
|---|---|
| Next.js | **16.3.6**, App Router |
| React / React DOM | **19.2.8** |
| TypeScript | strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Server-state | TanStack Query **5.104.0** |
| OpenAPI generation | OpenAPI TypeScript **7.13.0** |
| Unit/component tests | Vitest **5.0.2** |
| Browser tests | Playwright **1.63.0**, Chromium |
| Styling | CSS variables + звичайний CSS |
| Node.js | **20.9.0+** |
| Backend contract | FastAPI **0.38.0**, OpenAPI 3.1.0 |

Exact dependency graph зберігається у:

```text
frontend/package-lock.json
```

---

## 6. Структура frontend

```text
frontend/
  src/app/                 Next.js routes
  src/components/          reusable UI і application shell
  src/features/            login, devices, alarms, ui-kit features
  src/lib/api/             config, client, errors, endpoints, query policy
  src/lib/api/openapi.json tracked backend contract snapshot
  src/lib/api/schema.d.ts  generated TypeScript contract
  tests/browser/           Playwright Chromium smoke tests
  playwright.config.ts
  vitest.config.mts
  package.json
  package-lock.json
```

Основні routes Етапу 9:

```text
/login
/devices
/devices/{deviceId}
/alarms
/ui-kit
```

На цьому етапі `/login`, `/devices`, Device dashboard і alarms ще працюють на
явно позначених typed demo fixtures. Єдиний live HTTP-запит Етапу 9 —
публічний `/health` у `/ui-kit`.

---

## 7. Design system і базові компоненти

Створено повторно використовувані primitives:

- `Button` із primary/secondary/danger/ghost/disabled states;
- `Card`;
- `StatusBadge`;
- `TextField`;
- `SelectField`;
- `DataTable`;
- `PageHeader`;
- `MetricCard`;
- accessible `ConfirmDialog`;
- desktop sidebar;
- topbar;
- mobile bottom navigation.

Design tokens винесені у CSS variables, тому наступні екрани повинні
використовувати одну палітру, spacing, border, radius і focus policy, а не
створювати локальні стилі для кожної сторінки.

---

## 8. OpenAPI та API boundary

Frontend використовує контракт, експортований із реального FastAPI
`app.openapi()`.

Зафіксовано:

- OpenAPI **3.1.0**;
- backend version **0.38.0**;
- **47 paths**;
- tracked snapshot `openapi.json`;
- generated `schema.d.ts`;
- regeneration і zero-diff verification у CI.

Shared API adapter підтримує:

- JSON request/response;
- optional Bearer access token;
- CSRF header;
- `credentials: include` для HttpOnly cookie flow;
- `cache: no-store`;
- query parameters;
- timeout;
- `AbortSignal`;
- request cancellation;
- перевірку invalid JSON;
- normalized errors.

### Нормалізовані помилки

| Стан | Значення для UI |
|---|---|
| 401 | Сесію не підтверджено або завершено |
| 403 | Недостатньо прав |
| 404 | Ресурс відсутній або недоступний |
| 409 | Стан ресурсу змінився |
| 422 | Validation error |
| 429 | Rate limit із підтримкою `Retry-After` |
| 5xx | Backend error |
| Network | Backend недоступний |
| Timeout | Немає відповіді у відведений час |
| Aborted | Старий запит скасовано |
| Invalid response | Backend повернув неочікуваний формат |

Недоступний backend не відображається як «порожній список».

---

## 9. Cache і security policy

TanStack Query налаштовано так, щоб query keys могли містити:

```text
user → session → organization → site → device → resource
```

Зафіксовані правила:

- cache не persist-иться у `localStorage`;
- access token у майбутньому зберігається лише в memory;
- refresh token читається лише backend через HttpOnly cookie;
- logout/context switch мають cancel-ити pending requests;
- після cancel старий scoped cache видаляється;
- mutations не retry-яться автоматично;
- 401/403/404/409/422/429 не запускають нескінченні повтори;
- read retries bounded;
- UI не вважається security boundary: permissions повторно перевіряє FastAPI.

Ця основа підготовлена для Етапу 10, але session coordinator і route guards ще
не оголошуються реалізованими.

---

## 10. Автоматичні перевірки

### Unit/component tests

Vitest перевіряє:

- semantic button/status rendering;
- labels, hints та validation state полів;
- empty table без fake rows;
- HTTP status mapping;
- `Retry-After` seconds і HTTP date;
- validation messages;
- network/timeout copy.

Результат:

```text
2 test files
7 tests
7 passed
```

### Browser smoke tests

Playwright запускає production build через `next start` у Chromium і перевіряє:

- `/login` та його labels;
- `/devices`;
- перехід fleet → Device;
- explicit demo state;
- confirmation перед Start;
- відсутність неправдивого physical Result;
- API success;
- network failure окремо від empty state;
- mobile navigation.

Результат:

```text
4 tests
4 passed
```

---

## 11. CI та відтворюваність

Фінальний GitHub Actions gate працює read-only і виконує:

```text
npm ci
OpenAPI export
TypeScript contract generation
OpenAPI zero diff
api:verify
typecheck
lint
unit/component tests
production build
Chromium install
browser smoke tests
```

Ключові підтверджені runs:

- **36325337149** — фінальний read-only gate, success;
- **36325843460** — повтор після Windows `.venv` fix, success;
- **36326598452** — перевірка після закриття Етапу 9, success.

Browser report і failure artifacts зберігаються окремо та не потрапляють у Git.

---

## 12. Локальне Windows-приймання

Користувач виконав:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op4.ps1 -Start
```

Підтверджено:

- Windows PowerShell;
- Node.js **24.21.0**;
- project-local `.venv`;
- автоматичне встановлення backend schema dependencies;
- clean `npm ci`;
- OpenAPI **0.38.0 / 47 paths**;
- TypeScript — PASS;
- ESLint — PASS;
- Vitest — **7 passed**;
- production build — PASS;
- Playwright Chromium — **4 passed**;
- запуск KERUMO на `http://127.0.0.1:3000`;
- Device dashboard відкривається без рухомого Next.js `N`.

Фінальний acceptance result:

```text
PASS: Stage 9.4 clean install, API contract, unit tests, production build and Chromium smoke tests.
```

---

## 13. Ключові файли та артефакти

| Файл | Призначення |
|---|---|
| `frontend/package.json` | Скрипти, runtime і test dependencies |
| `frontend/package-lock.json` | Exact dependency graph |
| `frontend/next.config.ts` | Next.js config, typed routes, вимкнений dev indicator `N` |
| `frontend/src/lib/api/client.ts` | Shared HTTP client |
| `frontend/src/lib/api/errors.ts` | Normalized API errors |
| `frontend/src/lib/api/query-client.ts` | Retry/cache policy |
| `frontend/src/lib/api/query-keys.ts` | Scoped query keys |
| `frontend/src/lib/api/openapi.json` | Backend OpenAPI snapshot |
| `frontend/src/lib/api/schema.d.ts` | Generated TypeScript API contract |
| `frontend/playwright.config.ts` | Chromium test environment |
| `frontend/vitest.config.mts` | Unit/component test environment |
| `scripts/check-stage9-op4.ps1` | Повна Windows acceptance-перевірка |
| `.github/workflows/frontend-bootstrap.yml` | Read-only frontend CI |

---

## 14. Виявлені та виправлені проблеми

Під час реального bootstrap і Windows acceptance було знайдено проблеми, які
не приховувалися через `--force` або пропуски тестів:

1. Node.js спочатку не був установлений на локальному ПК.
2. Windows PowerShell блокував `npm.ps1`; скрипти переведено на `npm.cmd`.
3. Vitest 5 вимагав новіші Node type definitions.
4. React static renderer використовував `colSpan`, що виявив unit-test.
5. Локальний Python не мав FastAPI dependencies; створено project-local
   `.venv` із `backend/requirements.txt`.
6. Рухомий Next.js dev indicator `N` перекривав UI; його вимкнено у config.

Кожне виправлення було повторно перевірено CI та локальним запуском.

---

## 15. Межі готовності

Після Етапу 9 готові фундамент, UX, контракти й test infrastructure, але ще
**не готові**:

- реальний login/session UI;
- refresh coordinator;
- route guards;
- logout між вкладками;
- live organizations/sites/devices;
- live telemetry і polling;
- історичні графіки з API;
- command writes;
- фізичне Start/Stop/frequency;
- alarms/notifications workflows;
- QR claim і B2B provisioning;
- production deployment;
- production MQTT TLS/ACL;
- підтверджена робота з фізичним ESP32/VFD через весь frontend path.

Панель пристрою на цьому етапі є професійним interactive baseline, але її demo
values не є доказом фактичного стану насоса.

---

## 16. Підсумковий вердикт

Етап 9 створив підтримувану frontend-основу, а не тимчасову сторінку:

- прийнято професійний UX KERUMO;
- код розділено на routes, components, features і API layer;
- backend contract типізовано;
- помилки й cache semantics визначено;
- critical action не ототожнюється з physical Result;
- clean install і production build відтворюються;
- desktop/mobile behavior перевіряється Chromium;
- Windows і GitHub Actions дають однаковий PASS.

**Етап 9 завершено 4/4. Frontend roadmap: 4/24.**

Commit, що зафіксував завершення етапу:

```text
7291b34fc71a12d21243416ae3c35a51bfd696a3
Record completion of frontend Stage 9
```

---

## 17. Наступний етап

**Етап 10 — вхід, сесія та права.**

Поточна операція: **10.1 — справжній browser login email/password** за чинним
FastAPI contract:

```text
email + password
      ↓
CSRF-protected browser login
      ↓
HttpOnly refresh cookie
      ↓
access token only in memory
      ↓
confirmed transition to the cabinet
```

Під час 10.1 потрібно реалізувати неправильний пароль, disabled account,
validation errors, rate limit, network failure та безпечний перехід після
підтвердженого server response. QR claim, Passkey і B2B zero-touch provisioning
залишаються окремими наступними vertical features.