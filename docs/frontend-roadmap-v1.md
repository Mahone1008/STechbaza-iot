# Frontend v1 — поетапний план TechBaza

Дата: 27.09.2026. База: backend 0.38.0, Етап H закрито 5/5.
**Статус: план, реалізацію не розпочато. 6 етапів / 24 операції, прийнято 0/24.**

Етап 9 починає frontend-напрямок; щоб не змішувати великий frontend в один
етап, роботу поділено на Етапи 9–14. Кожен має чотири операції.
Нумерація попередніх етапів та H-01–H-05 залишається незмінною.

## 1. Результат першої версії

Користувач входить у власний кабінет, обирає організацію й об'єкт, бачить
пристрої та лише їхні доступні модулі. На панелі є якість/давність даних,
графіки, дозволені команди з реальним станом виконання, аварії та персональні
позначки прочитання. Працює на ПК і мобільному браузері з реальним demo API.

У перший release входять ролі, які вже має backend; viewer не може виконати
команду, operator працює лише зі своїми об'єктами. Усі права визначає сервер.
Тестова база — існуючий demo зі збереженням користувачів та `.env.demo`.

За межами першого release: платіжні підписки, B2B invitations/QR pairing,
масове provisioning, повний сервісний кабінет, редактор alarm rules,
камери/відео, OTA, довільні автоматизації, мобільний native app та offline
queue для команд. Для цих можливостей потрібні власні API та критерії.

## 2. Технічна основа

- Зберігаємо узгоджений у `technology-stack.md` стек: **React + Next.js +
  TypeScript**, адаптивний web UI. Версії фіксуємо в операції 9.2 після
  перевірки сумісності та безпеки; lockfile зберігаємо в Git.
- Next.js відповідає за сторінки й UI. Чинні auth/RBAC/business rules
  залишаються у FastAPI; другого backend або другої системи login не створюємо.
- Авторизовані dashboard-дані першої версії читаються клієнтським API adapter;
  не кладемо tenant data до загального SSR/cache. Статичний shell може
  використовувати Server Components, інтерактивні панелі — Client Components.
- Для server state доцільний **TanStack Query**: ключі містять user/session
  context, organization, Device і параметри. Кеш не є джерелом дозволів.
  При logout/зміні tenant скасовуємо запити й прибираємо дані попереднього контексту.
- TypeScript DTO отримуємо з OpenAPI; shared adapter нормалізує HTTP/network
  errors. Runtime checks потрібні на критичних межах, типізація не перевіряє
  довільну відповідь сама по собі.
- На старті — керований HTTP polling тільки видимих даних. WebSocket/SSE
  не оголошуємо наявною можливістю backend і не додаємо без потреби.
- Компонентні тести та **Playwright** для повного browser → API → MQTT demo.
  Перевірки доступності доповнюємо ручною перевіркою клавіатури та фокусу.

Локально обираємо одну пару адрес: UI `http://127.0.0.1:3000`, demo API
`http://127.0.0.1:8001`. Не змішуємо localhost і 127.0.0.1 в одному сценарії.
API використовує чинні exact origins, cookie path і CSRF header.
Refresh cookie HttpOnly; access token — у пам'яті застосунку. Tokens не
зберігаються у localStorage, URL, Git або логах.

Офіційні матеріали, використані для плану:
[Next.js authentication](https://nextjs.org/docs/app/guides/authentication),
[Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components),
[TanStack query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys),
[Playwright accessibility](https://playwright.dev/docs/accessibility-testing).
Конкретне розбиття операцій нижче є планом цього проєкту.

## 3. Карта екранів і API

Усі endpoint paths нижче мають prefix `/api/v1`.

| Екран | Джерело | Головне правило |
|---|---|---|
| Login / session | `/auth/browser/login`, `/refresh`, `/logout` під browser prefix; `/auth/me` | Один координатор session; refresh cookie не читає JavaScript |
| Організації / об'єкти | `/organizations`, `/organizations/{id}/access`, `/organizations/{id}/sites` | Tenant context перевіряється, URL не надає доступу сам по собі |
| Пристрої | `/sites/{id}/devices`, `/devices/{id}/availability` | Pagination; статус не підміняється вигаданим значенням |
| Панель | `/devices/{id}/overview` | modules/readings/state_readings/permissions з backend |
| Графік | `/devices/{id}/telemetry/series` | [start,end), time basis сервера, units та gaps з API |
| Команди / журнал | `/devices/{id}/commands`, `/commands/{id}` | Один request_id на один намір, ACK ≠ виконання |
| Аварії / події | `/devices/{id}/alarms`, `/alarms/{id}/transitions`, `/devices/{id}/events` | Acknowledge ≠ усунення аварії |
| Повідомлення | `/organizations/{id}/notifications`, `/unread-count` під цим prefix; `/notifications/{id}/read` | Read — персональна позначка, не acknowledge |

## 4. Етап 9 — структура інтерфейсу та основа проєкту

**Результат етапу:** погоджені екрани, працюючий shell та єдиний спосіб роботи з API.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 9.1 — Сценарії та макети | Карта сторінок, шлях owner/operator/viewer, desktop/mobile макети; погоджуємо мову UI, палітру TechBaza і терміни; таблиця всіх empty/error/offline станів | Зрозуміло, де пристрої, керування, аварії; модулі відрізняються між пристроями; макети не видаються за live data |
| 9.2 — Каркас і компоненти | Next.js/TS strict, структура за функціями, шрифти/кольори/відступи, navigation shell, кнопки, форми, таблиці, статуси, dialog; lockfile та config example | Запуск одним блоком PowerShell; ПК/телефон; читабельність, фокус, помилки форм; жодних credentials у bundle |
| 9.3 — API adapter і контракти | OpenAPI types, конфігурація API base URL, AbortSignal, timeout, 401/403/404/409/422/429/5xx; безпечні query keys та cache lifecycle | Недоступний API показує зрозумілий стан; помилка не виглядає як порожній список; response від старої сторінки не змінює нову |
| 9.4 — Відтворюваний baseline | Typecheck, lint, build, початкові component/browser checks і frontend CI; інструкція запуску; правила оновлення schema | Чисте встановлення та production build проходять; користувач відтворює запуск і приймає каркас |

## 5. Етап 10 — вхід, сесія та права

**Результат етапу:** користувач безпечно входить і потрапляє лише до доступного контексту.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 10.1 — Login | Форма email/password, browser endpoint, CSRF header, credentials include; помилки login і 429/Retry-After; password managers | Правильний/неправильний пароль, вимкнений account, ліміт спроб; password не потрапляє до логів і storage |
| 10.2 — Відновлення session | Reload через refresh cookie, access token тільки в пам'яті; single-flight refresh, координація вкладок, контроль запізнілих відповідей | F5, expiry access token, паралельні GET і дві вкладки не породжують нескінченні refresh або випадковий logout |
| 10.3 — Permissions і route guards | `/auth/me`, organization access; route context, меню за permissions, очистка кешу при перемиканні; backend лишається остаточним guard | Viewer/operator, чужий URL, відкликане membership та перемикання організації; чужі cached data не з'являються |
| 10.4 — Logout і збої | Узгоджений logout у вкладках, скасування pending requests, network/reconnect, відмова backend. UI розрізняє локальний вихід і підтверджений server revoke | Back після logout не відкриває дані; стара відповідь не відновлює login; немає прихованого повернення у session після мережевого збою |

Тестуємо race refresh/logout/login. Автоматичний повтор write-запиту після
401 не відбувається без окремої policy; для команд зберігається той самий
request_id. Навіть успішне приховування кнопки не вважається authorization test.

## 6. Етап 11 — об'єкти, пристрої та модульна панель

**Результат етапу:** перший робочий кабінет із живими даними; керування ще не увімкнене.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 11.1 — Організації й об'єкти | Списки, вибір поточного об'єкта, breadcrumbs, deep links, pagination; відновлення лише валідного вибору | Нуль/один/кілька об'єктів, відсутній доступ, F5 та посилання на конкретний об'єкт |
| 11.2 — Список пристроїв | Пагіновані рядки, тип і назва, presence для видимої сторінки; обмежена паралельність status-запитів | Новий, offline і online Device; зміна сторінки скасовує попередні запити; немає опитування всього парку |
| 11.3 — Registry віджетів | Мапа підтримуваних типів віджетів; backend modules/channels визначають склад; units, numeric/state readings, unsupported fallback | Насос, pressure-only, без модулів, unknown capability; лише доступні графіки й controls, false/0 зберігаються |
| 11.4 — Якість і зміна конфігурації | Fresh/stale/missing/invalid, час даних, session change, enabled/disabled module, lost permission; polling видимої панелі | Online зі старими даними відрізняється від fresh; вимкнений модуль зникає; missing не стає нулем; немає даних іншого Device при швидкому переході |

Для 11.2 не запускати overview для кожного пристрою всієї організації.
Спочатку невелика сторінка й bounded availability calls; якщо вимірювання
покажуть зайві запити, погодити невеликий summary endpoint у цій же операції.
Пошук лише по завантаженій сторінці не видавати за глобальний пошук.

## 7. Етап 12 — графіки та команди

**Результат етапу:** operator керує demo та бачить підтверджений результат.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 12.1 — Історія показань | Графік обраного підтримуваного каналу; min/max/average, units, діапазон і bucket; часовий пояс і зрозумілі gaps | Різні періоди; нуль ≠ gap; invalid/partial видно; API-ліміти 7 днів/1000 buckets/100000 packets обробляються без обрізання «мовчки» |
| 12.2 — Оновлення даних | Єдина політика polling, backoff, dedup/cancel, пауза прихованих вкладок; budget запитів; збереження останнього стану з позначкою втрати зв'язку | Вкладка у фоні, offline браузер, повільна мережа, швидка зміна Device/періоду; немає накладання запитів або неправдивої свіжості |
| 12.3 — Start/Stop/частота | Форми за allowed_commands, перевірка значень, один request_id на намір, захист double-click; явне підтвердження Start/зміни параметра | Viewer не керує; повтор того самого запиту не створює нову команду; невизначена HTTP-відповідь не показується як успіх; Stop не губиться за dialog Start |
| 12.4 — Lifecycle та журнал | Queued/published/acknowledged/succeeded/failed/expired/result_unknown; audit і TTL; стабільна pagination журналу, включно з R-09 backend tie-breaker | ACK не перетворюється на «насос працює»; failed/timeout/late result; немає автоматичного нового Start після unknown; журнал не дублює записи при рівному created_at |

Початкова policy UI: Start/зміна частоти не накопичуються локально для
відправки після reconnect. При невідомому зв'язку показуємо причину блокування
і стан уже створеної команди. Доступність Stop оцінюємо окремо: fault не є
причиною ховати Stop, але мережева команда не гарантує фізичну аварійну зупинку.
Налаштування безпечних частот конкретної установки та physical interlocks —
окремий hardware/pilot scope, а не припущення фронтенду.

## 8. Етап 13 — аварії, події та повідомлення

**Результат етапу:** користувач бачить проблему, її історію та свої прочитані повідомлення.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 13.1 — Аварії пристрою | Список з фільтрами, severity, active/resolved, incident detail і transitions | Відсутність аварій, активна аварія, відновлення, кілька інцидентів; resolved не показується як нова active |
| 13.2 — Acknowledge | Дія за permission, pending/error state, незмінне перше авторство, повтор без побічних ефектів | Viewer 403, operator acknowledge, паралельне resolution/409; підтвердження не маскує активну причину |
| 13.3 — In-app feed | Organization stream, unread count, персональне read, перехід до доступного Device/Alarm | Прочитання одного користувача не читає за іншого; немає повідомлень чужого tenant; revoke одразу закриває доступ |
| 13.4 — Наскрізний інцидент | Timeline подій і зв'язок з командами; MQTT → rule → alarm → notification → acknowledge → recovery через UI | Demo low pressure/fault/recovery; переходи зрозумілі, notifications не дублюються від retry, порожні та мережеві стани перевірені |

Загальний organization alarm dashboard не симулювати сотнями запитів по
кожному Device: у v1 є device alarms і organization notifications.
Якщо потрібне глобальне зведення всіх active alarms, це окремий bounded API.

## 9. Етап 14 — якість та приймання першого frontend

**Результат етапу:** відтворювана перша тестова версія frontend + backend.

| Операція | Що виконуємо | Що перевіряє користувач |
|---|---|---|
| 14.1 — Повна UX-перевірка | Остаточна перевірка mobile/tablet/desktop, клавіатури, focus, контрасту, масштабування тексту; узгоджені loading/error/empty | Усі основні екрани й controls з телефона та ПК; помилки зрозумілі без технічного traceback |
| 14.2 — Browser regression | Playwright на реальному demo: login → об'єкт → Device → chart → command → alarm; ролі, два tenants, дві вкладки; компонентні регресії | Є звіт PASS без пропущених обов'язкових сценаріїв; ручний повтор критичного шляху; браузери матриці 9.1 перевірені |
| 14.3 — Security і performance | Cache isolation, session races, text escaping, відсутність tokens у storage/logs; CSP/headers для обраного способу serving; запити/heap/bundle/perceived latency, dependency scan | Немає витоку даних після logout/switch; hidden tab не створює storm; довгий сеанс і багато переходів без зростання запитів/пам'яті; звіт вимірювань |
| 14.4 — Release і досьє | Production build, чистий запуск documented script, E2E збереженого demo, точна ревізія та версії, release notes/відомі межі; користувацьке приймання | Один вставний блок команд, повний сценарій, screenshots/PASS; лише після цього закриваємо 14.4, Етап 14 та frontend v1 |

Responsive й доступність починаються з 9.2; 14.1 — остаточна перевірка,
а не перша спроба адаптувати готовий desktop. Аналогічно тести додаються
разом із кожною операцією, 14.2 збирає їх у повну регресію.

## 10. Правила даних і перевірок

1. Module assignment ≠ фізичний sensor instance; UI не обіцяє кілька pressure
   sensors одного Device до нового контракту. Unknown module має явний fallback.
2. Online, свіжість telemetry, успіх HTTP, ACK та фізичний результат — різні
   стани. Не зливати їх в одну зелену позначку «все працює».
3. Права беруться з API. Ключі кешу відділяють user/session/tenant/device;
   logout та context switch очищають дані й блокують запізнілі відповіді.
4. Графік не домальовує нуль або безперервну лінію через відсутні показання.
   Timezone валідний або використовується явно позначений UTC fallback.
5. Automatic GET retry — bounded; 401/403/404/422 не запускають нескінченні
   повтори. Для 429 враховується Retry-After. Write retries мають окремі правила.
6. Початкові polling intervals і budgets фіксуються у 9.3/12.2 та вимірюються;
   довільна кількість timers у widgets не допускається.
7. Mock data потрібні для component tests, але фінальний acceptance іде через
   реальний API/MQTT simulator. У робочому UI mock не маскує збій API.
8. E2E використовує окремі fixtures/ізольований стенд; не змінює паролі
   користувача і не видаляє його demo volumes. Новий frontend CI не замінює backend suite.

## 11. Залежності від backend

Для першого read/control UI основні API вже є. План не передбачає новий
великий backend до першого екрана. Вузькі доповнення робимо лише там, де
з'являється реальний сценарій, з поясненням і регресією:

- 9.3: перевірка фактичної OpenAPI schema і способу обробки errors;
- 11.2: за виміряної потреби summary API замість надмірного fan-out;
- 12.4: стабільний tie-breaker command history (R-09);
- майбутні форми створення: R-07 name/timezone validation;
- майбутній rule editor: R-08 metric/config validation та semantics змін rules.

Запрошення користувачів, account recovery, QR claim, device lifecycle,
кілька однотипних sensors, external notifications та deployment readiness
не підміняємо декоративними кнопками. Вони будуть окремими повними вертикальними
функціями: backend + UI + тести + приймання.

## 12. Формат спільної роботи

Для кожної операції: коротко пояснюємо мету й терміни → робимо обмежену зміну
у `main` → автоматично перевіряємо → надаємо один зручний PowerShell-блок і
видимі критерії → користувач надсилає screenshot/результат або «є» → фіксуємо
приймання в журналі. Операція закривається після цього, етап — після всіх його
операцій. Нова гілка не створюється. Наступну операцію автоматично не закриваємо.

| Контрольна точка | Очікуваний результат |
|---|---|
| Після Етапу 9 | Каркас і базова якість проєкту |
| Після Етапу 10 | Робочий login/session/RBAC |
| Після Етапу 11 | Живий кабінет і модульна панель |
| Після Етапу 12 | Графіки та керування demo |
| Після Етапу 13 | Повний базовий operator workflow з аваріями |
| Після Етапу 14 | Прийнята перша тестова frontend-версія |

Строки не фіксуються до погодження макетів та першої операції. 24 операції —
базовий обсяг, який можна уточнити при виявленні реальної нової вимоги;
це не обіцянка завершеного комерційного продукту після 24 повідомлень.

**Початкова точка: операція 9.1 — сценарії, карта сторінок і макети.**
Оцінка основи та наступні production-роботи:
[повторний огляд backend](backend-review-after-h-2026-09-27.md).
