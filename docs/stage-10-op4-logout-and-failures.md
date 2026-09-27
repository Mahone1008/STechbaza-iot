# Етап 10, операція 4 — logout, revoke і захист від session resurrection KERUMO

Дата реалізації: 27.09.2026.  
Backend base: **0.38.0**.  
Вхідний статус: операції 10.1–10.3 закрито, Етап 10 — **3/4**, frontend roadmap — **7/24**.

> **Статус: реалізацію завершено, фінальний автоматичний CI пройдено.**
>
> Операція 10.4 ще не закрита: очікується локальне Windows-приймання
> користувачем. До цього моменту Етап 10 залишається 3/4, roadmap — 7/24.

---

## 1. Мета операції

Завершити browser-auth lifecycle справжнім виходом, який не обмежується
видаленням локального React state.

Прийнятий ланцюжок:

```text
користувач натискає «Вийти з акаунта»
        ↓
frontend переходить у logging-out
        ↓
приховує tenant content
        ↓
скасовує активні authorized requests
        ↓
POST /api/v1/auth/browser/logout
  credentials: include
  X-TechBaza-CSRF: 1
        ↓
backend відкликає server-side auth session
        ↓
backend видаляє HttpOnly refresh cookie
        ↓
frontend очищує access token і private cache
        ↓
BroadcastChannel повідомляє інші вкладки
        ↓
усі вкладки переходять на /login?loggedOut=1
        ↓
F5 або новий /devices не відновлює завершену session
```

Server-side revoke є остаточною межею. Локальне приховування сторінки без
підтвердженого backend logout не видається за успішний вихід.

---

## 2. HTTP-контракт logout

Frontend використовує чинний backend endpoint:

```text
POST /api/v1/auth/browser/logout
```

Обов’язкові умови:

- `credentials: include` для надсилання HttpOnly refresh cookie;
- exact browser `Origin`;
- `X-TechBaza-CSRF: 1`;
- body не потрібний;
- успішна відповідь — `204 No Content`;
- endpoint є ідемпотентним: відсутня/вже відкликана cookie також не створює
  помилкову нову session.

Після успішного logout backend:

1. знаходить поточну refresh session;
2. встановлює `revoked_at`;
3. видаляє cookie `techbaza_refresh` через `Max-Age=0`;
4. відхиляє старий access JWT цієї session через перевірку session row.

Реальний Chromium test додатково викликає `/api/v1/auth/me` зі старим access
token після logout і очікує `401`, тобто revoke діє до природного expiry JWT.

---

## 3. Frontend state machine

До auth session state додано окремі стани:

| State | Значення |
|---|---|
| `logging-out` | logout intent зафіксовано, tenant content уже приховано, backend request виконується |
| `logout-failed` | результат logout не підтверджено; session не оголошується завершеною |
| `anonymous / logout` | backend підтвердив revoke, access/caches очищені, повторне recovery заблоковано |

Під час `logging-out`:

- AppShell і сторінка пристроїв більше не рендеряться;
- нові authorized requests не стартують;
- активні requests отримують `AbortController.abort("logout")`;
- refresh timers і retry timers зупиняються;
- peer snapshot waiters завершуються без token;
- session-scoped TanStack Query cache очищується.

Це прибирає проміжок, у якому користувач уже попросив вихід, але старі
відповіді ще могли б повернути tenant data в інтерфейс.

---

## 4. Координація між вкладками

Logout серіалізовано тим самим cross-tab auth lock, що й refresh/login:

- Web Locks API — основний механізм;
- короткожива localStorage lease — fallback;
- BroadcastChannel — доставка результату іншим same-origin вкладкам.

Після успішного logout надсилається:

```text
session-cleared
reason: logout
issuedAt: <timestamp>
```

Інші вкладки:

1. відкидають memory-only access token;
2. скасовують requests;
3. очищують private cache;
4. не відповідають на `session-request` старим token snapshot;
5. переходять на `/login?loggedOut=1`.

Лише вкладка, яка отримала auth lock, виконує backend logout request. Інші
вкладки не створюють race з refresh rotation і не надсилають дублікати revoke.

---

## 5. Logout tombstone без secrets

Щоб нова вкладка або F5 не відновили session із запізнілого peer snapshot,
frontend записує короткоживучий marker:

```text
localStorage key: kerumo.auth.logout.v1
```

Marker містить тільки:

```json
{
  "issuedAt": 0,
  "expiresAt": 0,
  "nonce": "random-id"
}
```

У ньому немає:

- access token;
- refresh token;
- email;
- user id;
- organization id;
- role або permissions.

Marker має TTL п’ять хвилин і видаляється після нового явного успішного login.
Навіть якщо storage недоступне, server-side revoked session і видалена cookie
залишаються остаточним захистом.

---

## 6. Захист від session resurrection

Після успішного logout перевіряються всі основні шляхи випадкового
«повернення» сесії:

- proactive refresh timer;
- refresh після `visibilitychange` або focus;
- refresh після `401`;
- same-document single-flight promise;
- BroadcastChannel token snapshot;
- запізніла відповідь старого request;
- F5 на login;
- відкриття `/devices` у новій вкладці;
- одночасно відкриті вкладки з уже наявним access token.

Кожний шлях перевіряє logout intent/marker. Snapshot або API response,
виданий до logout, не може повторно застосуватися після новішого logout event.

---

## 7. Поведінка при збоях logout

Мережева помилка, timeout або `5xx` створює невизначений результат: backend
міг отримати request, а браузер — не отримати response. Тому frontend не
показує повідомлення «сесію завершено» без доказу.

Замість цього:

- tenant content приховано;
- показується окремий екран `Не вдалося завершити сесію`;
- доступні `Повторити вихід` і `Повернутися до кабінету`;
- при поверненні використовується попередній access token лише якщо він ще
  придатний; інакше session повторно перевіряється через backend;
- `429` враховує `Retry-After` і тимчасово блокує повторну кнопку;
- logout write не повторюється автоматично у фоні без участі користувача.

Ця модель не плутає «ми приховали UI» з «server-side session відкликано».

---

## 8. Інтерфейс користувача

Додано user menu:

- у desktop — кнопка `…` у нижній частині sidebar;
- у mobile — avatar button у topbar;
- у меню видно реальний email, role і organization;
- action: `Вийти з акаунта`;
- підпис прямо пояснює, що буде відкликано поточну browser session.

Після успішного виходу сторінка login показує:

```text
Сесію завершено
Server-side session відкликано, приватний cache очищено в усіх відкритих вкладках.
```

URL:

```text
/login?loggedOut=1
```

`loggedOut=1` не є authorization signal. Він лише показує UX-повідомлення;
доступ усе одно визначається cookie/backend session.

---

## 9. Cache і request cleanup

При logout виконується:

1. abort усіх requests, створених через `authorizedRequest`;
2. cancel TanStack Query requests;
3. remove усіх keys із prefix `kerumo/session/...`;
4. remove access-context state;
5. збереження public cache, наприклад `/health`;
6. відкидання запізнілих access-resolution responses за run/version guard.

Private data однієї session не повинні пережити вихід або з’явитися в іншій
session після наступного login.

---

## 10. Нові й змінені файли

| Файл | Призначення |
|---|---|
| `frontend/src/features/auth-coordination.ts` | logout message, tombstone і cross-tab serialization |
| `frontend/src/features/auth-session.tsx` | logout state machine, abort requests, revoke, retry/cancel |
| `frontend/src/features/access-context.tsx` | cleanup access context після logout |
| `frontend/src/features/workspace-guard.tsx` | logging-out і logout-failed gates |
| `frontend/src/components/app-shell.tsx` | desktop/mobile user menu і logout action |
| `frontend/src/features/login.tsx` | success notice і відсутність automatic recovery після logout |
| `frontend/src/app/auth.css` | user menu, logout notice і responsive styles |
| `frontend/src/lib/api/endpoints.ts` | typed browser logout request |
| `frontend/tests/browser/logout.spec.ts` | mocked success, tabs, failure, Retry-After |
| `frontend/tests/browser/logout.live.spec.ts` | real backend revoke і cross-tab logout |
| `scripts/check-stage10-op4.ps1` | кумулятивна Windows-перевірка 10.4 |
| `.github/workflows/frontend-bootstrap.yml` | запуск оновлених mocked/live suites |

---

## 11. Автоматичні докази

Основна реалізація:

```text
5ae1b9296552b6fae3941ae9d30043a0f704085b
Implement Stage 10.4 coordinated browser logout
```

Під час CI виявлено дві реальні проблеми:

1. React ESLint заборонив синхронний `setState` у effect для `loggedOut`
   notice — реалізацію замінено на location snapshot через
   `useSyncExternalStore`, правило не вимикалося;
2. mocked `Retry-After` був недоступний browser JavaScript без
   `Access-Control-Expose-Headers` — CORS fixture виправлено, а test window
   збільшено до трьох секунд для стабільного підтвердження disabled state.

Фінальна code revision:

```text
46b6d90217709f8ed91f67a5cd16ae999387df91
Stabilize logout Retry-After browser check
```

Фінальний GitHub Actions run:

```text
36341962519 — completed / success
```

### Frontend job

Пройдено:

- OpenAPI 0.38.0 / 47 paths і zero diff;
- TypeScript strict;
- ESLint із zero warnings policy;
- Vitest — **7 files, 23 tests, 23 passed**;
- Next.js production build;
- mocked Chromium — **23 passed**.

### Real backend job

В isolated PostgreSQL/Mosquitto/FastAPI environment пройдено **8 real
Chromium tests**, включно з:

1. owner login/profile/access;
2. wrong-password generic error;
3. F5 session recovery;
4. two-tab refresh coordination;
5. anonymous route guard;
6. viewer permission restrictions;
7. real logout: `204`, cookie removal, old access → `401`, F5 не відновлює session;
8. logout однієї вкладки очищує інші вкладки, а новий protected route
   залишається anonymous.

Passwords були masked. Isolated containers, network і volumes після run
видалено.

---

## 12. Локальна Windows-перевірка

Перед запуском зупинити попередній Next.js через `Ctrl+C`. Docker Desktop
залишити запущеним у Linux containers mode.

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op4.ps1 -Start
```

Очікуваний фінал:

```text
PASS: Stage 10.4 server-side logout, cross-tab revoke, private cache cleanup and no session resurrection.
Starting KERUMO at http://127.0.0.1:3000/login
```

Скрипт не друкує demo passwords і не видаляє прийняті demo volumes.

---

## 13. Ручне приймання

1. Увійти як owner або дочекатися automatic recovery чинної owner session.
2. Відкрити `/devices` у другій звичайній вкладці того самого browser profile.
3. У першій вкладці натиснути `…` біля користувача.
4. Обрати `Вийти з акаунта`.
5. Обидві вкладки мають перейти на `/login?loggedOut=1`.
6. В обох вкладках має бути повідомлення `Сесію завершено`.
7. Натиснути `F5`: session не повинна відновитися.
8. У новій вкладці відкрити `/devices`: workspace не показується, browser
   залишається на login/logout state.
9. У жодному screenshot не повинно бути password, access або refresh token.

---

## 14. Критерії закриття

Операція 10.4 закривається після підтвердження:

1. cumulative Windows script завершується Stage 10.4 PASS;
2. logout викликається через реальний backend;
3. поточна вкладка переходить на `loggedOut=1`;
4. друга вкладка також очищується без другого backend logout request;
5. F5 і новий protected route не відновлюють завершену session;
6. tenant data не показуються під час logout/failure;
7. користувач приймає результат.

До цього моменту статус залишається **реалізовано, CI PASS, очікується
локальне користувацьке приймання**.

---

## 15. Межі та наступний етап

- logout відкликає **поточну browser session**, а не всі сесії користувача;
- список активних сесій і `logout all devices` не входять до frontend v1;
- offline logout без доступу до backend не вважається підтвердженим;
- domain data пристроїв, telemetry та alarms залишаються typed demo fixtures;
- після приймання 10.4 Етап 10 буде завершено **4/4**, roadmap — **8/24**;
- наступна операція — **11.1: реальні організації, об’єкти, breadcrumbs,
  deep links і відновлення валідного tenant context**.
