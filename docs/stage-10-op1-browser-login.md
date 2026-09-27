# Етап 10, операція 1 — справжній browser login KERUMO

Дата реалізації: 27.09.2026.  
Дата приймання: 27.09.2026.  
Backend base: **0.38.0**.  
Вхідний статус: Етап 9 завершено 4/4, frontend roadmap **4/24**.

> **Статус: операцію 10.1 прийнято користувачем і закрито 27.09.2026.**
>
> Етап 10: **1/4**. Frontend roadmap: **5/24**. Наступна операція — **10.2**.

---

## 1. Мета операції

Замінити демонстраційну форму `/login` на справжній browser-login через
чинний FastAPI contract без створення другої системи авторизації у Next.js.

Користувацький сценарій:

```text
email + password
      ↓
POST /api/v1/auth/browser/login
      ↓
Origin + X-TechBaza-CSRF перевіряє FastAPI
      ↓
HttpOnly refresh cookie + короткоживучий access token
      ↓
access token залишається лише у пам’яті вкладки
      ↓
підтверджений перехід до /devices
```

Операція 10.1 охоплює саме первинний вхід. Відновлення сесії після F5,
route guards і logout належать відповідно до 10.2, 10.3 та 10.4.

---

## 2. Реалізований backend contract

Frontend використовує наявний endpoint:

```text
POST /api/v1/auth/browser/login
```

Обов’язкові умови запиту:

- exact browser Origin;
- header `X-TechBaza-CSRF: 1`;
- `Content-Type: application/json`;
- `credentials: include`;
- email і password у JSON body;
- відсутність автоматичного retry login mutation.

Успішна відповідь перевіряється як `BrowserTokenResponse`:

```text
access_token
token_type = bearer
expires_in
session_expires_in
```

Refresh session зберігається backend у cookie:

```text
techbaza_refresh
HttpOnly
SameSite=Strict
Path=/api/v1/auth/browser
```

Frontend не читає cookie через JavaScript.

---

## 3. Реалізація у frontend

### 3.1. Реальна форма входу

`frontend/src/features/login.tsx` тепер:

- надсилає справжній POST до FastAPI;
- нормалізує email;
- валідовує поля до HTTP-запиту;
- блокує повторне натискання під час pending state;
- скасовує попередній незавершений request;
- очищає password після credential/auth помилки;
- не очищає password при простому network failure;
- переходить до `/devices` лише після валідної server response;
- показує accessible alert і повертає focus до помилки;
- підтримує countdown за `Retry-After` при 429.

### 3.2. Memory-only access token

`frontend/src/features/auth-session.tsx` створює мінімальний session context:

- access token зберігається у `useRef`;
- token не записується у `localStorage`;
- token не записується у `sessionStorage`;
- token не потрапляє в URL;
- UI зберігає лише email і timestamps, потрібні для поточної вкладки;
- метод `getAccessToken()` підготовлено для наступних authenticated requests.

Після F5 access token навмисно втрачається до реалізації refresh coordinator
в операції 10.2. Це чесна межа, а не прихована несправність.

### 3.3. Runtime validation

`frontend/src/lib/api/endpoints.ts` не довіряє JSON лише через TypeScript.
Response додатково перевіряється у runtime:

- `access_token` — string у допустимому діапазоні;
- `token_type` — лише `bearer`;
- `expires_in` — додатне ціле;
- `session_expires_in` — додатне ціле.

Некоректний `200 OK` перетворюється на `invalid-response`, а сесія не
вважається створеною.

---

## 4. Стани й повідомлення

| Ситуація | Поведінка UI |
|---|---|
| Порожній email/password | Inline validation без HTTP-запиту |
| Некоректний email | Пояснення формату і focus на email |
| 401 | Загальне «Невірний email або пароль» без account enumeration |
| 403 | Account/origin access denied, без створення сесії |
| 422 | Backend validation state |
| 429 | Countdown із `Retry-After`, submit тимчасово disabled |
| 503/5xx | Окремий backend error state |
| Network | «Backend недоступний», не «невірний пароль» і не empty state |
| Timeout | Backend не відповів у відведений час |
| Invalid JSON/schema | Сесію не створено, показано contract error |
| Success | Password очищено, access у memory, redirect на `/devices` |

Email невідомого користувача й неправильний пароль не розрізняються у UI.

---

## 5. Відображення після входу

Після успіху application shell показує:

- email підтвердженого користувача;
- статус `Сесія підтверджена · demo data`;
- пояснення, що access token знаходиться в пам’яті.

При цьому devices, telemetry, alarms і commands залишаються typed demo data
до відповідних етапів. Маршрути поки не захищені від прямого відкриття — це
завдання 10.3. У UI це позначено як `Demo data · guard у 10.3`.

---

## 6. Безпекові рішення

1. Password не записується до storage, URL або application state після success.
2. Access token не persist-иться.
3. Refresh token існує лише як HttpOnly cookie.
4. Login request має CSRF header і точний Origin.
5. Login mutation не retry-иться автоматично.
6. 401 не розкриває, чи існує email.
7. CI і локальний acceptance script не друкують demo password.
8. GitHub Actions маскує password до передачі Playwright.
9. Local script читає пароль із прийнятого `.env.demo`, використовує його лише
   як process environment для тесту і після завершення відновлює environment.
10. Backend залишається остаточним security boundary.

---

## 7. Нові й змінені файли

| Файл | Призначення |
|---|---|
| `frontend/src/features/login.tsx` | Реальна форма та browser-login flow |
| `frontend/src/features/login-model.ts` | Validation і безпечне відображення auth errors |
| `frontend/src/features/auth-session.tsx` | Memory-only access token/session metadata |
| `frontend/src/lib/api/endpoints.ts` | Typed browser-login endpoint і runtime response validation |
| `frontend/src/components/providers.tsx` | AuthSessionProvider у root provider tree |
| `frontend/src/components/app-shell.tsx` | Authenticated/anonymous session indication |
| `frontend/src/app/auth.css` | Auth alerts і session visual states |
| `frontend/src/features/login-model.test.ts` | Unit tests login validation/error mapping |
| `frontend/tests/browser/login.spec.ts` | Mocked Chromium scenarios |
| `frontend/tests/browser/login.live.spec.ts` | Real FastAPI/PostgreSQL browser login |
| `frontend/playwright.live.config.ts` | Окремий live-login test environment |
| `scripts/check-stage10-op1.ps1` | Повний локальний Windows gate |
| `.github/workflows/frontend-bootstrap.yml` | Frontend + isolated live-login CI jobs |

---

## 8. Автоматичні перевірки

Основна реалізація:

```text
99c3587d00b38513e101bee4ac654564005dc9ae
Implement Stage 10.1 real browser login
```

Перший browser run виявив неоднозначний Playwright locator: Next.js має
власний hidden route announcer із `role=alert`. Бізнес-логіка не падала;
тест було професійно уточнено до `.login-alert`, без вимкнення перевірки.

Фінальні виправлення:

```text
46da95e8b5f5df1652ab9d62923ad162927eb60d
5037d3868f089acb3af224dfa8ef37a37ec42945
```

Фінальний GitHub Actions run:

```text
36329977001 — completed / success
```

### Frontend job

Пройдено:

- OpenAPI 0.38.0 / 47 paths і zero diff;
- TypeScript strict;
- ESLint;
- Vitest — **3 files, 11 tests, 11 passed**;
- Next.js production build;
- mocked Playwright Chromium — **9 passed**.

Mocked browser tests перевіряють:

- client validation без зайвого POST;
- CSRF header та request body;
- HttpOnly cookie handling;
- відсутність token у browser storage;
- invalid credentials;
- 429 countdown;
- network failure;
- попередні Stage 9 routes і mobile navigation.

### Live-login job

В isolated CI environment створено:

- нові PostgreSQL/Mosquitto volumes;
- backend 0.38.0;
- всі migrations до `20260926_0017`;
- demo accounts;
- masked credentials;
- production Next.js build;
- Chromium.

Real browser tests — **2 passed**:

1. правильний password → 200, HttpOnly cookie, authenticated access token,
   успішний `/api/v1/auth/me`, redirect на `/devices`;
2. неправильний password → 401 і однакове безпечне повідомлення.

Після тесту isolated containers і volumes видалено.

---

## 9. Локальна Windows-перевірка

Користувач виконав:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op1.ps1 -Start
```

Підтверджено на локальному Windows-середовищі:

- Node.js **24.21.0**;
- OpenAPI 0.38.0 / 47 paths;
- TypeScript strict і ESLint;
- Vitest — **11 passed**;
- production build;
- mocked Chromium — **9 passed**;
- Docker demo PostgreSQL, Mosquitto і backend — Healthy;
- real Chromium login — **2 passed**;
- фінальний рядок `PASS: Stage 10.1 real browser login...`;
- запуск KERUMO на `http://127.0.0.1:3000/login`.

Demo password було скопійовано з `.env.demo` до clipboard без виведення у
PowerShell. На наданому screenshot пароль видно лише як стандартні masked dots.
Відкритого password, refresh secret або access token у console, URL чи screenshot
не зафіксовано.

Користувач вручну увійшов як:

```text
owner@techbaza-demo.example.com
```

Після натискання `Увійти` підтверджено:

- redirect на `/devices`;
- email у sidebar;
- `Сесія підтверджена · demo data` у topbar;
- password не відображається у workspace;
- demo fleet залишається явно позначеним як demo data.

---

## 10. Критерії закриття — виконано

1. Acceptance script завершився PASS.
2. Live Playwright показав 2 passed.
3. Реальний правильний login перевів на `/devices`.
4. Wrong-password behavior автоматично перевірено generic error.
5. Email і session status відображаються.
6. Password/token не опубліковані у screenshot або console.
7. Користувач надав screenshots і підтвердив результат.

**Операцію 10.1 закрито. Етап 10: 1/4. Frontend roadmap: 5/24.**

---

## 11. Наступні операції

- **10.2 — наступна:** refresh coordinator, session recovery після F5,
  single-flight і coordination між вкладками;
- **10.3** — `/auth/me`, permissions, organization access і route guards;
- **10.4** — logout, revoke, cancel pending requests і no session resurrection.

QR claim, Passkey і B2B zero-touch provisioning не змішуються з базовим login
і залишаються окремими vertical features.
