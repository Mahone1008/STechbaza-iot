# Етап 10, операція 2 — відновлення browser session KERUMO

Дата реалізації та приймання: 27.09.2026.  
Backend base: **0.38.0**.  
Вхідний статус: операцію 10.1 закрито, Етап 10 — **1/4**, frontend roadmap — **5/24**.

> **Статус: закрито 27.09.2026 після автоматичного CI та локального Windows-приймання.**
>
> Підсумковий статус: Етап 10 — **2/4**, frontend roadmap — **6/24**.
> Наступна операція — **10.3: `/auth/me`, permissions, organization access,
> cache isolation і route guards**.

---

## 1. Мета операції

Зберегти безпечну browser session після перезавантаження сторінки, не
переносячи access token до `localStorage`, `sessionStorage`, URL або звичайної
JavaScript cookie.

Основний сценарій:

```text
успішний login
      ↓
access token лише у пам’яті вкладки
refresh token лише в HttpOnly cookie
      ↓
F5 / нова вкладка / повернення до браузера
      ↓
POST /api/v1/auth/browser/refresh
      ↓
ротація refresh token на backend
      ↓
новий access token у пам’яті
      ↓
сесія продовжується без повторного password
```

Операція також повинна не допустити одночасної ротації одного refresh token
кількома вкладками.

---

## 2. Реалізована модель станів

`AuthSessionProvider` тепер розрізняє:

| Стан | Значення для UI |
|---|---|
| `restoring` | Browser перевіряє HttpOnly session; це ще не logout |
| `authenticated` | Access token чинний у пам’яті |
| `authenticated + degraded` | Поточний access ще чинний, але refresh тимчасово не пройшов |
| `unavailable` | Backend/network тимчасово недоступний, остаточний logout не підтверджено |
| `anonymous / expired` | Backend підтвердив відсутню або завершену session |
| `anonymous / revoked` | Доступ/refresh session відкликано або заборонено |

Тимчасовий network error не перетворюється на «невірний пароль» або
безумовний logout. `401/403` від refresh endpoint є остаточним серверним
сигналом, а network/timeout/5xx запускають обмежене повторення.

---

## 3. Refresh contract

Frontend використовує чинний endpoint:

```text
POST /api/v1/auth/browser/refresh
```

Запит:

- має exact Origin;
- містить `X-TechBaza-CSRF: 1`;
- виконується з `credentials: include`;
- не читає refresh cookie у JavaScript;
- не передає refresh token у body, URL або storage.

Відповідь повторно перевіряється у runtime як `BrowserTokenResponse`:

```text
access_token
token_type = bearer
expires_in
session_expires_in
```

Некоректний `200 OK` не створює session і переходить до `invalid-response`.

---

## 4. Відновлення після F5

Під час першого mount:

1. provider переходить до `restoring`;
2. перевіряє, чи інша вкладка вже має достатньо свіжий access token;
3. якщо peer snapshot відсутній — викликає browser refresh;
4. backend ротує HttpOnly refresh token;
5. новий access token залишається у `useRef`;
6. UI переходить до authenticated state;
7. topbar показує `Сесія відновлена · demo data`.

При відкритті `/login` із чинною HttpOnly session форма не просить password
повторно: після успішного recovery відбувається перехід на `/devices`.

---

## 5. Single-flight у межах вкладки

Для одного document використовується спільний promise:

- паралельні startup/focus/API refresh calls приєднуються до одного request;
- повторний refresh не створюється, поки перший не завершено;
- timer, visibility handler і authenticated GET не змагаються між собою;
- після завершення promise очищається.

Це захищає від подвійного refresh у React Strict Mode та від одночасних
споживачів access token в одному application tree.

---

## 6. Coordination між вкладками

Refresh token rotation на backend одноразова, тому простого mutex недостатньо:
друга вкладка не повинна лише почекати, а потім повторно використати вже
замінений token.

Реалізовано:

1. **Web Locks API** як основний cross-tab mutex.
2. **Lease у localStorage** як fallback для browser без Web Locks.
   У storage записується тільки owner/nonce/expiry lock metadata — жодного token.
3. **BroadcastChannel** для передачі короткоживучого access snapshot між
   вкладками того самого origin.
4. **Targeted peer request** після отримання lock, щоб не втратити broadcast,
   який міг прийти безпосередньо перед блокуванням.
5. Вкладка-лідер застосовує та публікує новий access token **до звільнення lock**.
6. Вкладка, що чекала, приймає peer snapshot і не виконує другу rotation.

Access token при цьому не persist-иться: він існує тільки в пам’яті відкритих
same-origin вкладок. Закриття всіх вкладок видаляє його; наступний запуск знову
використовує HttpOnly refresh cookie.

---

## 7. Proactive refresh і retry policy

Після authentication provider планує refresh до завершення access token:

- довгі token-и оновлюються приблизно за хвилину до expiry;
- короткі — орієнтовно за 20% залишкового часу, але без tight loop;
- при поверненні focus/visibility перевіряється залишкова validity;
- `Retry-After` має пріоритет;
- інакше застосовується bounded backoff: 1, 5, 15, 30, 60 секунд.

Якщо поточний access token ще чинний, temporary refresh failure показує
`degraded`, але не знищує робочу session. Якщо access уже непридатний — UI
показує `unavailable` і повторює перевірку у фоні.

---

## 8. Authenticated API helper

Підготовлено `authorizedRequest<T>()`:

- отримує достатньо свіжий memory access token;
- за потреби виконує single-flight refresh;
- для safe GET може один раз оновити token і повторити request після `401`;
- write requests за замовчуванням не retry-яться автоматично;
- callers можуть явно вимкнути або дозволити retry policy.

Це є основою для `/auth/me` та live tenant/device requests наступних операцій.

---

## 9. Безпекові правила

1. Refresh token залишається тільки в HttpOnly cookie.
2. Access token не зберігається у localStorage/sessionStorage/URL.
3. localStorage fallback містить лише короткоживучу lock lease metadata.
4. BroadcastChannel працює лише між вкладками того самого origin.
5. Кожне channel message проходить runtime validation.
6. Expired або надто короткоживучий peer snapshot не приймається.
7. Старі session events не перезаписують новіші.
8. Login і refresh серіалізовані одним auth lock.
9. Network uncertainty не запускає необмежений retry storm.
10. Write request не повторюється автоматично після невизначеного результату.

---

## 10. Нові й змінені файли

| Файл | Призначення |
|---|---|
| `frontend/src/features/auth-coordination.ts` | Cross-tab messages, lock/lease, timing і retry helpers |
| `frontend/src/features/auth-session.tsx` | Recovery state machine, single-flight, proactive refresh, authorized request |
| `frontend/src/lib/api/endpoints.ts` | `browserRefresh()` і runtime token validation |
| `frontend/src/features/login.tsx` | Restoring state та автоматичний redirect при чинній session |
| `frontend/src/components/app-shell.tsx` | Restored/degraded/unavailable session indicators |
| `frontend/src/app/auth.css` | Session state styling |
| `frontend/src/features/auth-coordination.test.ts` | Unit tests message validation, expiry, timers і backoff |
| `frontend/tests/browser/session.spec.ts` | Mocked F5, tabs, auto-redirect і temporary failure |
| `frontend/tests/browser/session.live.spec.ts` | Real backend F5 recovery і concurrent tabs |
| `scripts/check-stage10-op2.ps1` | Кумулятивна Windows-перевірка 10.2 |

---

## 11. Автоматичні докази

Основна реалізація:

```text
bbab9d1299b9c039bb15c81016c5de327e95f054
Implement Stage 10.2 session recovery
```

CI виявив реальну race condition: перший варіант серіалізував вкладки, але
друга вкладка після очікування все одно виконувала другу token rotation.
Тест не було послаблено. Архітектуру виправлено через targeted peer handshake
і commit/broadcast усередині lock.

Фінальна code revision:

```text
a2d1a73ac26ec0af3603d1d6fe0c363fd8fc1526
Deduplicate Stage 10.2 cross-tab refresh
```

CI та документаційна інтеграція:

```text
7236e880e9937ad01d7733594f132cee1826246d
Extend frontend CI for Stage 10.2 session recovery
```

Фінальний GitHub Actions run:

```text
36334330557 — completed / success
```

### Frontend job

Пройдено:

- OpenAPI 0.38.0 / 47 paths і zero diff;
- TypeScript strict;
- ESLint;
- Vitest — **4 files, 15 tests, 15 passed**;
- Next.js production build;
- mocked Chromium — **13 passed**.

### Real backend job

В isolated PostgreSQL/Mosquitto/backend environment пройдено **4 real browser
tests**:

1. справжній login і `/auth/me`;
2. wrong-password generic error;
3. F5 → real refresh rotation → новий usable access token;
4. дві вкладки → рівно один refresh request → обидві session відновлено.

Усі demo credentials були masked; isolated containers і volumes після run
видалено.

---

## 12. Локальне Windows-приймання

27.09.2026 користувач виконав cumulative acceptance на Windows 11:

```powershell
Set-Location "C:\Users\seraf\Documents\TechBaza\techbaza-iot"
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage10-op2.ps1 -Start
```

Зафіксований результат:

```text
Vitest: 15 passed
Mocked Chromium: 13 passed
Real Chromium: 4 passed
Docker PostgreSQL: Healthy
Docker Mosquitto: Healthy
Docker backend: Healthy
PASS: Stage 10.2 HttpOnly session recovery, proactive refresh, single-flight and cross-tab coordination.
Starting KERUMO at http://127.0.0.1:3000/login
```

Ручне приймання підтвердило:

1. відкриття `http://127.0.0.1:3000/login` із чинною HttpOnly session;
2. короткий стан `Перевіряємо наявну сесію` / `Відновлюємо сесію…`;
3. автоматичний redirect на `/devices` без email/password;
4. статус у topbar `Сесія відновлена · demo data`;
5. відсутність access token у localStorage/sessionStorage/URL;
6. повторний password не запитується;
7. screenshots не містять demo password або token.

Це саме очікувана поведінка 10.2: `/login` не повинен показувати форму входу,
якщо backend підтвердив чинну refresh session.

---

## 13. Критерії закриття

| Критерій | Результат |
|---|---|
| Cumulative acceptance script | **PASS** |
| Mocked browser tests | **13 passed** |
| Real browser tests | **4 passed** |
| F5/session recovery не повертає на login | **PASS** |
| UI показує restored session | **PASS** |
| Cross-tab refresh rotation | **PASS, один refresh request у real test** |
| Локальні screenshots і приймання користувача | **PASS** |

**Операцію 10.2 закрито.**

---

## 14. Межі та наступні операції

- **10.3 — наступна операція:** `/auth/me`, актуальні permissions,
  organization access, cache isolation і route guards;
- **10.4:** справжній logout/revoke, cancel pending requests і захист від
  session resurrection.

Операція 10.2 не оголошує demo devices живими даними та ще не блокує прямий
anonymous access до routes — це свідомо залишається scope 10.3.