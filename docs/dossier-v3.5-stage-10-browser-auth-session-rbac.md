# Досьє V3.5 — Етап 10
## Browser Authentication, Session Recovery, RBAC & Logout KERUMO

Дата завершення: **27.09.2026**  
Backend base: **0.38.0**  
Статус: **Етап 10 завершено 4/4. Frontend roadmap — 8/24.**

---

## 1. Мета Етапу 10

Етап 10 перетворив frontend KERUMO з демонстраційного shell на захищений
browser application із реальним FastAPI authentication lifecycle,
відновленням сесії, ролями, permissions, route guards і server-side logout.

До початку етапу frontend уже мав Next.js + TypeScript strict foundation,
responsive UI, generated OpenAPI contract, shared API adapter, TanStack Query,
unit/component tests і Chromium smoke tests.

Після завершення Етапу 10 browser-auth flow:

~~~text
Email + пароль
      ↓
POST /api/v1/auth/browser/login
      ↓
HttpOnly refresh cookie + memory-only access token
      ↓
GET /api/v1/auth/me
      ↓
organizations + memberships
      ↓
GET /api/v1/organizations/{organization_id}/access
      ↓
role + permissions
      ↓
protected workspace
      ↓
F5 / second tab → coordinated refresh
      ↓
server-side logout / revoke
~~~

---

## 2. Операції Етапу 10

| Операція | Результат | Статус |
|---|---|---|
| 10.1 — Browser login | Реальний email/password login, CSRF, HttpOnly refresh cookie, memory-only access token, auth error states | **Закрито** |
| 10.2 — Session recovery | F5 recovery, proactive refresh, single-flight і cross-tab coordination | **Закрито** |
| 10.3 — Profile, permissions & guards | /auth/me, organization access, permissions, route guards, cache isolation | **Закрито** |
| 10.4 — Logout & failures | Server-side revoke, cross-tab logout, private cache cleanup, Retry-After, no session resurrection | **Закрито** |

Детальні досьє:

- [10.1 — browser login](stage-10-op1-browser-login.md)
- [10.2 — session recovery](stage-10-op2-session-recovery.md)
- [10.3 — permissions and guards](stage-10-op3-permissions-and-guards.md)
- [10.4 — logout and failures](stage-10-op4-logout-and-failures.md)

---

## 3. Операція 10.1 — справжній browser login

Форма /login підключена до реального FastAPI browser endpoint.

Реалізовано:

- POST /api/v1/auth/browser/login;
- exact Origin + X-TechBaza-CSRF: 1;
- credentials: include;
- HttpOnly refresh cookie;
- access token лише в оперативній пам'яті вкладки;
- runtime validation backend response;
- email normalization і client-side validation;
- окремі стани 401/403/422/429/5xx/network/timeout;
- generic login error без розкриття існування акаунта;
- safe redirect тільки після підтвердженого backend response.

Access token не записується у localStorage, sessionStorage, URL або JS-readable cookie.

---

## 4. Операція 10.2 — відновлення browser session

Додано автоматичне відновлення session після F5 та у новій вкладці.

~~~text
reload / new tab
      ↓
POST /api/v1/auth/browser/refresh
      ↓
refresh rotation
      ↓
новий access token у memory
      ↓
workspace відновлено
~~~

Реалізовано:

- recovery без повторного введення пароля;
- proactive refresh;
- single-flight усередині вкладки;
- cross-tab serialization;
- Web Locks API;
- fallback localStorage lease;
- BroadcastChannel;
- peer token snapshot;
- bounded retry/backoff;
- distinction між temporary outage і logout.

Під час тестів знайдено cross-tab race після refresh rotation. Його виправлено:
нова вкладка отримує актуальний snapshot до release auth lock і не виконує
другий refresh зі старим token.

---

## 5. Операція 10.3 — профіль, організації, permissions і guards

Після login/recovery frontend отримує реальний access context:

- GET /api/v1/auth/me;
- GET /api/v1/organizations;
- GET /api/v1/organizations/{organization_id}/access.

Frontend отримує реальний email, display name, platform role, auth_session_id,
memberships, active organization, organization role і exact permissions.

Permission-aware UI:

| UI | Permission |
|---|---|
| Devices | device.read |
| Alarms | alarm.read |
| Components | capability.read |
| Add device | device.create |
| Start / Stop / frequency | command.execute |
| Module settings | capability.manage |

Viewer може читати дані, але не може виконувати керувальні дії.

Anonymous direct navigation на /devices перенаправляється на
/login?returnTo=%2Fdevices без показу tenant data до завершення access resolution.

---

## 6. Session-scoped cache isolation

TanStack Query cache ізольовано за user_id + auth_session_id + organization_id.

При зміні session:

- pending requests cancel-яться;
- private cache попередньої session видаляється;
- запізнілі відповіді старої session ігноруються;
- public cache, наприклад /health, може зберігатися.

Це усуває ризик короткого показу даних попереднього користувача.

---

## 7. Операція 10.4 — server-side logout

Logout не обмежується очищенням React state.

~~~text
Вийти з акаунта
      ↓
hide tenant content
      ↓
cancel authorized requests
      ↓
POST /api/v1/auth/browser/logout
      ↓
server-side revoke
      ↓
delete HttpOnly cookie
      ↓
clear access token + private cache
      ↓
BroadcastChannel → other tabs
      ↓
/login?loggedOut=1
~~~

Backend revoke робить старий access JWT недійсним до natural expiry.

Logout в одній вкладці очищує всі same-origin вкладки та не дозволяє
peer-token resurrection.

Logout marker kerumo.auth.logout.v1 містить лише issuedAt, expiresAt і nonce.
У ньому немає token, email, user id, organization id, role або permissions.

---

## 8. Failure handling

Network/timeout/5xx під час logout не видається за успішний результат.

Frontend показує:

- Не вдалося завершити сесію;
- Повторити вихід;
- Повернутися до кабінету.

Для 429 враховується Retry-After. Logout write не повторюється автоматично
без участі користувача.

---

## 9. User menu

Додано account menu:

- desktop — унизу sidebar;
- mobile — у topbar;
- real email;
- role;
- organization;
- дія Вийти з акаунта.

Під час Windows-приймання знайдено UX-дефект: desktop popover виходив за межі
sidebar. Він був виправлений і покритий Playwright regression test, який
перевіряє геометрію menu.

---

## 10. Проблеми, знайдені та виправлені

### Cross-tab refresh race
Друга вкладка могла зробити зайвий refresh після token rotation.

**Виправлення:** snapshot передається до release auth lock.

### React effect lint
Синхронний state update для logout notice не відповідав React rule.

**Виправлення:** location snapshot через useSyncExternalStore.

### Retry-After CORS
Browser JS не бачив Retry-After у mocked fixture.

**Виправлення:** Access-Control-Expose-Headers.

### Windows PowerShell parsing
UTF-8 script із non-ASCII text некоректно парсився Windows PowerShell 5.1.

**Виправлення:** acceptance script зроблено сумісним із Windows PowerShell.

### User-menu overflow
Account popover виходив за fixed sidebar.

**Виправлення:** width/max-width обмежено sidebar; додано Playwright bounds check.

### Logout redirect deduplication
Під час ручного тестування було помічено повторні переходи на /login?loggedOut=1.

**Виправлення:** protected-route redirect deduplicated і покритий regression check.

### TypeScript narrowing
Перша версія dedup effect зверталась до session.reason без narrowing union type.

**Виправлення:** reason використовується лише після перевірки anonymous state.

---

## 11. Автоматичні перевірки

Фінальний accumulated gate Етапу 10:

~~~text
OpenAPI 0.38.0 / 47 paths       PASS
TypeScript strict               PASS
ESLint                          PASS
Vitest                          23 passed
Mocked Chromium                 23 passed
Real backend Chromium            8 passed
Next.js production build        PASS
PostgreSQL                      Healthy
Mosquitto                       Healthy
FastAPI                         Healthy
~~~

Real Chromium suite перевіряє anonymous navigation, owner login/profile/access,
wrong-password generic error, viewer restrictions, F5 recovery, two-tab refresh
coordination, real backend logout/revoke та cross-tab logout.

---

## 12. Локальне Windows-приймання

Користувач підтвердив:

- browser login;
- automatic recovery після F5;
- owner access context;
- viewer read-only restrictions;
- anonymous protected-route redirect;
- server-side logout;
- повідомлення Сесію завершено;
- відсутність session resurrection;
- professional user-menu positioning;
- фінальний cumulative Stage 10.4 PASS.

Password, access token і refresh token на screenshots не розкривались.

---

## 13. Основні файли Етапу 10

Frontend:

~~~text
frontend/src/features/auth-session.tsx
frontend/src/features/auth-coordination.ts
frontend/src/features/access-context.tsx
frontend/src/features/workspace-guard.tsx
frontend/src/features/login.tsx
frontend/src/features/login-model.ts
frontend/src/components/app-shell.tsx
frontend/src/lib/api/access.ts
frontend/src/lib/api/endpoints.ts
frontend/src/lib/api/query-client.ts
frontend/src/lib/api/query-keys.ts
~~~

Browser tests:

~~~text
frontend/tests/browser/login.spec.ts
frontend/tests/browser/login.live.spec.ts
frontend/tests/browser/session.spec.ts
frontend/tests/browser/session.live.spec.ts
frontend/tests/browser/access.spec.ts
frontend/tests/browser/access.live.spec.ts
frontend/tests/browser/logout.spec.ts
frontend/tests/browser/logout.live.spec.ts
~~~

Acceptance:

~~~text
scripts/check-stage10-op1.ps1
scripts/check-stage10-op2.ps1
scripts/check-stage10-op3.ps1
scripts/check-stage10-op4.ps1
~~~

---

## 14. Security properties після Етапу 10

1. Refresh token доступний лише через HttpOnly cookie.
2. Access token залишається memory-only.
3. Browser auth POST захищені exact Origin + CSRF header.
4. Backend повторно перевіряє permissions.
5. Anonymous user не бачить tenant data до auth resolution.
6. Cache ізольовано за user/session.
7. Logout відкликає server-side session.
8. Старий access token після logout відхиляється.
9. Cross-tab coordination не зберігає secrets у localStorage.
10. Temporary failure не плутається з logout.
11. Route guard не замінює server-side authorization.
12. Write operations не мають небезпечного automatic retry.

---

## 15. Межі

Етап 10 не реалізує MFA, password reset, email verification, Passkey,
B2B QR claim/provisioning, список усіх active sessions, logout all devices,
live telemetry або live command execution у frontend.

Це окремі майбутні функції, а не незавершені критерії Етапу 10.

---

## 16. Підсумок

До Етапу 10:

~~~text
UI shell
+ demo login
+ API foundation
~~~

Після Етапу 10:

~~~text
real browser login
+ secure HttpOnly session
+ memory-only access
+ F5 recovery
+ cross-tab refresh
+ /auth/me
+ organizations
+ RBAC
+ permission-aware UI
+ protected routes
+ session cache isolation
+ real server-side logout
+ cross-tab revoke
+ no session resurrection
~~~

**Етап 10 завершено 4/4.**

Frontend roadmap: **8/24 operations accepted.**

Наступна операція: **11.1 — реальні організації, об'єкти, breadcrumbs,
deep links і відновлення валідного tenant context.**
