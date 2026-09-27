# Етап 10, операція 3 — профіль, permissions і route guards KERUMO

Дата реалізації та приймання: 27.09.2026.  
Backend base: **0.38.0**.  
Вхідний статус: операції 10.1–10.2 закрито, Етап 10 — **2/4**, frontend roadmap — **6/24**.

> **Статус: операцію 10.3 прийнято користувачем і закрито 27.09.2026.**
>
> Автоматичний CI та локальне Windows-приймання пройдено. Етап 10 — **3/4**,
> frontend roadmap — **7/24**. Наступна операція — **10.4: logout, revoke і
> захист від session resurrection**.

---

## 1. Мета операції

Перетворити відновлену browser session на перевірений користувацький і
tenant-контекст до показу будь-яких даних кабінету.

Основний ланцюжок:

```text
підтверджена browser session
        ↓
GET /api/v1/auth/me
        ↓
реальний user + auth_session_id + memberships
        ↓
GET /api/v1/organizations
        ↓
активна доступна організація
        ↓
GET /api/v1/organizations/{organization_id}/access
        ↓
organization role + точний набір permissions
        ↓
session-scoped cache
        ↓
route guard + permission-aware navigation і controls
```

Frontend більше не використовує demo email, організацію або роль як джерело
authorization. Остаточне рішення для кожного API request, як і раніше,
приймає backend.

---

## 2. Профіль поточного користувача

Після authentication виконується:

```text
GET /api/v1/auth/me
```

Frontend отримує і runtime-перевіряє:

- `id` користувача;
- `email`;
- `display_name`;
- `platform_role`;
- `is_active`;
- `auth_session_id`;
- `auth_session_expires_at`;
- memberships із `organization_id` та organization role.

Некоректний `200 OK`, невідоме значення ролі, невалідний UUID або date-time
не створює access context. Така відповідь переходить у окремий
`invalid-response`, а не показує demo profile.

`auth_session_id` використовується не як authorization token, а як частина
ізольованого cache scope конкретної browser session.

---

## 3. Організація та актуальний доступ

Після `/auth/me` виконуються:

```text
GET /api/v1/organizations?limit=100&offset=0
GET /api/v1/organizations/{organization_id}/access
```

Перша версія автоматично обирає першу активну організацію, яка одночасно:

1. присутня у memberships поточного користувача;
2. повернута backend як видима;
3. має `is_active=true`.

Для `superadmin` допускається перша активна видима організація навіть без
звичайного membership. Повноцінний вибір між кількома організаціями буде
реалізовано в Етапі 11.

Access response повторно перевіряється:

- `organization_id` має збігатися з requested organization;
- `platform_role` і `organization_role` мають належати відомому enum;
- кожний permission має належати чинному permission registry;
- дублікати permissions видаляються без розширення прав.

---

## 4. Permission registry

Поточний frontend розпізнає чинні backend permissions:

```text
organization.read
site.read
site.create
device.read
device.create
telemetry.read
event.read
alarm.read
notification.read
alarm.acknowledge
command.read
command.execute
capability.read
capability.manage
membership.read
membership.manage
```

Невідомий permission не приймається «про запас». Це навмисно робить зміну
backend contract видимою під час тестів і не дозволяє frontend випадково
надати нову дію без погодженої реалізації.

---

## 5. Route guards

Усі workspace routes тепер знаходяться всередині `WorkspaceGuard`.
До відображення дочірнього екрана перевіряються session, profile,
organization і permissions.

| Route | Потрібний permission |
|---|---|
| `/devices` і `/devices/*` | `device.read` |
| `/alarms` і `/alarms/*` | `alarm.read` |
| `/ui-kit` і `/ui-kit/*` | `capability.read` |

Anonymous direct navigation, наприклад:

```text
http://127.0.0.1:3000/devices
```

переводиться на:

```text
/login?returnTo=%2Fdevices
```

До redirect не показується sidebar, назва організації, demo fleet або інший
tenant content. Після успішного login дозволений локальний `returnTo`
відновлює запитаний route.

`returnTo` приймає лише внутрішні захищені routes KERUMO. Absolute URL,
protocol-relative URL, backslash, `/login`, невідомий route або зовнішній
origin безпечно замінюються на `/devices`, що прибирає open-redirect risk.

---

## 6. Access states без витоку tenant data

Frontend розрізняє:

| Стан | Поведінка |
|---|---|
| session restoring | показується нейтральна перевірка session |
| session unavailable | tenant data приховані, доступний bounded retry |
| anonymous | redirect на login із безпечним `returnTo` |
| access resolving | окремо завантажуються profile/organizations/access |
| access unavailable | backend/network error не видається за logout або empty fleet |
| no active organization | explicit no-access state |
| missing route permission | explicit «Недостатньо прав», без рендерингу сторінки |
| ready | AppShell і дозволений route стають видимими |

Тимчасова відмова `/auth/me` або `/access` не переводить користувача на login
і не показує старі дані попередньої session. `401/403` profile endpoint може
очистити локальний access state, але server-side logout/revoke повністю
завершується лише в операції 10.4.

---

## 7. Реальний AppShell

Після успішної перевірки AppShell показує дані backend:

- email поточного користувача;
- `display_name`;
- роль у поточній організації;
- назву активної організації;
- navigation items, дозволені permissions.

Приклади role labels:

| Backend role | UI |
|---|---|
| `owner` | Власник |
| `admin` | Адміністратор |
| `operator` | Оператор |
| `viewer` | Спостерігач |
| `service` | Сервісний спеціаліст |
| `service_admin` | Адміністратор сервісу |
| `superadmin` | Суперадміністратор |

Організація demo owner/viewer у live environment тепер показується як
`DEMO: клієнт A`, а не як hardcoded `АгроПром Північ`.

---

## 8. Permission-aware actions

Маршрут і видимість меню — не єдині guards. Critical controls також
використовують permissions:

- Start/Stop/frequency вимагають `command.execute`;
- settings/capability management вимагає `capability.manage`;
- Add Device перевіряє `device.create`;
- menu items фільтруються за відповідним read permission.

Для viewer:

- devices і telemetry залишаються видимими;
- Start, Stop, frequency і settings disabled;
- UI показує точну причину: відсутній `command.execute` або
  `capability.manage`;
- backend усе одно повторно перевірить permission після підключення live
  command endpoint у Етапі 12.

Прихована або disabled кнопка не вважається остаточною authorization boundary.

---

## 9. Session-scoped cache isolation

TanStack Query keys тепер починаються з:

```text
kerumo / session / user_id / auth_session_id / ...
```

Приклади:

```text
... / auth / me
... / organizations
... / organizations/{organization_id}/access
... / devices/{device_id}/overview
```

При зміні `user_id` або `auth_session_id`:

1. pending requests попередньої session скасовуються;
2. cache попередньої session видаляється;
3. public cache, наприклад `/health`, зберігається;
4. запізніла відповідь старого access resolution не застосовується.

Unit tests окремо підтверджують, що очищення session A не видаляє session B
або public data, а global authenticated cleanup не зачіпає public cache.

---

## 10. Нові й змінені файли

| Файл | Призначення |
|---|---|
| `frontend/src/lib/api/access.ts` | Runtime contracts profile, organization, access і permission registry |
| `frontend/src/lib/api/access.test.ts` | Unit tests contract validation і role labels |
| `frontend/src/lib/api/query-keys.ts` | Session-scoped query keys |
| `frontend/src/lib/api/query-client.ts` | Targeted/all-session cache cleanup |
| `frontend/src/lib/api/query-client.test.ts` | Cache isolation tests |
| `frontend/src/features/access-context.tsx` | `/auth/me` → organization → access state machine |
| `frontend/src/features/workspace-guard.tsx` | Session/access/permission route guard |
| `frontend/src/app/access.css` | Neutral, warning і denied access states |
| `frontend/src/components/app-shell.tsx` | Real user, organization, role і permission-aware navigation |
| `frontend/src/features/login-model.ts` | Safe local `returnTo` validation |
| `frontend/src/features/devices.tsx` | Permission-aware device actions |
| `frontend/src/features/alarms.tsx` | Real organization context, demo incident label |
| `frontend/tests/browser/access.spec.ts` | Mocked anonymous, role, outage і no-access scenarios |
| `frontend/tests/browser/access.live.spec.ts` | Real anonymous redirect і viewer restrictions |
| `scripts/check-stage10-op3.ps1` | Кумулятивна Windows-перевірка 10.3 |

---

## 11. Автоматичні докази

Основна реалізація почалася commit:

```text
7ff62253e86059a78af7551da5527da9c171902f
Implement Stage 10.3 permissions and route guards
```

Strict TypeScript і ESLint виявили кілька реальних contract/typed-route
невідповідностей. Перевірки не послаблювалися; типи route, role labels і
state transition були виправлені.

Фінальна code revision:

```text
e35bae38f537eca497f6ae03d4beed19ffe07781
Use typed protected return route after login
```

Фінальний GitHub Actions run:

```text
36337595188 — completed / success
```

### Frontend job

Пройдено:

- OpenAPI 0.38.0 / 47 paths і zero diff;
- TypeScript strict;
- ESLint із zero warnings policy;
- Vitest — **6 files, 22 tests, 22 passed**;
- Next.js 16.3.6 production build;
- mocked Chromium — **19 passed**.

### Real backend job

В isolated PostgreSQL/Mosquitto/FastAPI environment пройдено **6 real
Chromium tests**:

1. owner login + `/auth/me` + organization access;
2. wrong-password generic error;
3. F5 recovery із повторним profile/access resolution;
4. дві вкладки з однією refresh rotation;
5. anonymous direct route не показує workspace;
6. real viewer отримує роль `viewer` і disabled command controls.

Owner і viewer passwords були masked. Isolated containers, network і volumes
після run видалено.

---

## 12. Локальна Windows-перевірка

Користувач виконав перевірку на Windows 11 / Node.js 24.21.0 командою:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op3.ps1 -Start
```

Перший локальний запуск виявив сумісність Windows PowerShell 5.1 із UTF-8
без BOM: український текст у скрипті був інтерпретований як smart quote і
спричинив parser error. Скрипт переведено на ASCII-compatible service messages
у commit:

```text
51ce7a20cc7cf9244bfe950831442898d5a4e7f6
Fix Windows PowerShell parsing in Stage 10.3 check
```

Після `git pull` повторна перевірка завершилась успішно.

Локально підтверджено:

```text
OpenAPI 0.38.0 / 47 paths — PASS
TypeScript strict — PASS
ESLint — PASS
Vitest — 6 files, 22 passed
Next.js production build — PASS
Mocked Chromium — 19 passed
PostgreSQL / Mosquitto / FastAPI — Healthy
Real Chromium owner/viewer/session/guards — 6 passed
PASS: Stage 10.1+ authentication, HttpOnly session and real role checks.
PASS: Stage 10.2 HttpOnly session recovery, proactive refresh, single-flight and cross-tab coordination.
PASS: Stage 10.3 /auth/me profile, organization access, permission-aware UI, cache isolation and route guards.
```

Після gate KERUMO успішно запущено на:

```text
http://127.0.0.1:3000/login
```

Скрипт не друкував owner/viewer passwords і не видаляв прийняті demo volumes.

---

## 13. Ручне приймання — фактичний результат

### A. Anonymous guard — PASS

У приватному/Incognito вікні користувач відкрив:

```text
http://127.0.0.1:3000/devices
```

Браузер перейшов на:

```text
http://127.0.0.1:3000/login?returnTo=%2Fdevices
```

До login було показано лише нейтральний стан `Перевіряємо сесію`; fleet,
sidebar, назва організації та інші tenant data не з’являлися.

### B. Owner context — PASS

Після відновлення owner session UI показав:

- organization `DEMO: клієнт A`;
- `owner@techbaza-demo.example.com` у sidebar;
- role `DEMO: owner · Власник`;
- сторінку `/devices` лише після завершення session/profile/access resolution;
- кнопку `Додати пристрій`, доступну відповідно до owner permissions.

### C. Viewer restrictions — PASS

У приватному вікні користувач перейшов на:

```text
http://127.0.0.1:3000/devices/north-pump
```

і увійшов як:

```text
viewer@techbaza-demo.example.com
```

Після login safe `returnTo` повернув браузер на requested Device route. UI
показав:

- organization `DEMO: клієнт A`;
- viewer email у sidebar;
- role `DEMO: viewer · Спостерігач`;
- disabled `Запустити` і `Зупинити`;
- disabled frequency apply;
- disabled `Налаштування`;
- explicit warning: поточна роль не має permission `command.execute`.

На наданих screenshots passwords і access/refresh tokens не розкриті.

---

## 14. Критерії закриття

| Критерій | Результат |
|---|---|
| cumulative Windows script завершується Stage 10.3 PASS | **PASS** |
| anonymous `/devices` redirect без tenant-data flash | **PASS** |
| owner бачить реальні profile, organization і роль | **PASS** |
| viewer бачить реальну роль | **PASS** |
| viewer не може активувати command/capability controls | **PASS** |
| screenshots не містять passwords або tokens | **PASS** |
| користувач прийняв результат | **PASS** |

**Операцію 10.3 закрито.**

---

## 15. Межі та наступна операція

- device list, telemetry, alarms і command timeline поки є typed demo fixtures;
  live domain data починаються в Етапі 11;
- frontend guard не замінює backend authorization;
- organization switcher для кількох memberships належить 11.1;
- server-side logout/revoke ще не підключено до user action;
- **наступна операція 10.4:** справжній browser logout/revoke, coordinated
  cleanup між вкладками, cancel pending requests і захист від session
  resurrection після виходу.

## 16. Підсумковий вердикт

Операція 10.3 створила професійну межу між session authentication і доступом
до tenant workspace. KERUMO перевіряє `/auth/me`, активну організацію та
точні backend permissions до рендерингу даних, ізолює cache за user/session,
не допускає open redirect і не показує заборонені controls як доступні.

```text
Етап 9: 4/4
Етап 10: 3/4
Frontend roadmap: 7/24
Наступна операція: 10.4
```
