# Етап 11.2 — список пристроїв та обмежені перевірки зв’язку

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата: 28.09.2026. Реалізовано разом із [11.1](stage-11-op1-organizations-sites.md).

**Прийнято й закрито 28.09.2026 разом із 11.1. CI та Windows:
31 unit / 40 mocked / 10 live — PASS. Решта ручних сценаріїв підтверджена
користувачем повідомленням «Работает». Прийнято 10/24.**

## Поведінка й бюджет запитів

- Справжній `GET /sites/{id}/devices`: назва, UID, тип, lifecycle status,
  UUID-посилання, 20 видимих рядків і один lookahead.
- Availability тільки для видимих пристроїв: максимум **4 одночасні запити**,
  timeout одного GET — 5 секунд. Lookahead та решта парку не опитуються.
- Фонових polling timers немає: відкриття сторінки або «Оновити зв’язок».
  Час перевірки видимий. Старий Online прихований під час нової перевірки.
- Зміна сторінки, контексту й logout скасовують запити/чергу; worker після
  abort не бере наступний пристрій. Query key містить user, session, org,
  site, resource і page. Cache списків видаляється після від’єднання observer.
- «Оновити список» повторно перевіряє список і availability. Placeholder
  попередньої сторінки немає. Availability query retry вимкнено; auth adapter
  зберігає одноразовий GET replay на 401. Жодних command/write requests.

| Відповідь | Відображення |
|---|---|
| `online=true`, валідний `last_seen_at` | Online |
| `online=false`, відомий `last_seen_at` | Offline |
| `last_seen_at=null` | Ще не було зв’язку |
| Network/timeout/5xx/429/некоректна availability | Стан невідомий; ручне оновлення |
| 403/404 availability | Рядки приховано, помилка й шлях відновлення |

Час показаний у timezone об’єкта, з UTC fallback для невідомого timezone.
**Online не означає свіжу телеметрію, активний lifecycle або фізичну роботу
насоса.** Немає вигаданих fleet totals, alarm counters чи чисел сенсорів.

`/devices/{UUID}` показує справжню identity й availability. Модулі/канали —
11.3, quality/config/revoke — 11.4, реальні команди — Етап 12. Невідомий ID
більше не відкриває перший demo device. Демонстраційна панель перенесена до
`/ui-kit/device-demo`, явно позначена; її permission/confirmation регресії
збережені. `/alarms` поки демонстраційний.

## Спільна перевірка у Windows

Зупинити попередній Next.js через `Ctrl+C`. Docker Desktop — Linux containers.
У корені repository:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage11-op1-op2.ps1 -Start
```

Скрипт ASCII-сумісний із Windows PowerShell 5.1. Накопичувальний gate 10.4
запускає **всі актуальні** unit, mocked і live suites, чисту збірку й OpenAPI
zero-diff. Існуючі `.env.demo`, passwords і volumes зберігаються. Passwords
не друкуються; автоматичного reset немає.

Очікуваний фінал:

```text
PASS: Stage 11.1-11.2 organizations, sites, validated context, paginated devices and bounded presence.
```

Після PASS `-Start` запускає <http://127.0.0.1:3000/login>.

1. Звичним demo owner обрати організацію → об’єкт → пристрої.
2. Перевірити реальні UID, lifecycle і зв’язок; натиснути «Оновити зв’язок».
3. Відкрити пристрій: справжня назва/UID, без вигаданих telemetry values
   або кнопок реальних команд. Повернутися через breadcrumbs.
4. F5 і `/devices`: вибір відновлюється після перевірки API.
5. Повторити на вузькому екрані; перевірити вихід у двох вкладках.

Demo seed має одну owner-організацію й п’ять її пристроїв. Мультисторінкові
каталоги, два доступні tenants і повільні відповіді перевіряє mocked suite;
live suite — реальну tenant isolation. Simulator для тестів не потрібен:
нові/історичні пристрої законно можуть бути без зв’язку або Offline.
Живий heartbeat доступний через вже налаштований demo simulator.

## Windows-прогін 28.09.2026 та виправлення login navigation

Користувач оновив `main` до `14c096b` і запустив
`check-stage10-op4.ps1 -Start`. Цей накопичувальний скрипт виконує всі актуальні
suites, включно з 11.1/11.2; його назва не є причиною помилки.

Підтверджено скриншотами: OpenAPI 0.38.0 / 47 paths, typecheck, lint,
**31 unit**, production build, **38 mocked** — PASS. Demo seed збережений;
PostgreSQL/Mosquitto/backend Healthy. Live suite: **9 passed / 1 failed**.
Падіння: `login.live.spec.ts`, читання `meResponse.json()` після переходу;
Chromium повідомив `Network.getResponseBody: No data found for resource`.
Повідомлення gate 10.1 → 10.4 — каскад одного failure, а не окремі збої.

Виправлення:

- login має одного власника redirect: effect після authenticated state;
  дубль `router.replace` із submit handler прибрано, повторний effect
  захищений ref;
- AccessContext не завантажує профіль на `/login` і `/`; перший `/auth/me`
  запускається вже у workspace, без скасування попереднього login-запиту;
- live test зчитує JSON login/profile/access одразу при response event,
  зберігаючи перевірки status, identity, role, permissions, cookie та storage;
- нові mocked регресії затримують відповідь маршруту `/devices` для login
  і refresh. До переходу profile requests відсутні; після — рівно один
  успішний, без abort;
- CI додатково повторює обидві регресії по 5 разів із `--retries=0`.

Повторний Windows-прогін спільним `check-stage11-op1-op2.ps1 -Start`
успішний: 31 unit, 40 mocked і 10 live. Додаткові 10 повторів регресій
запускаються окремим кроком GitHub Actions.

## Докази після виправлення

Повний [Frontend checks #36428489957](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36428489957)
завершився **success** для code revision
[`8a6af14`](https://github.com/Mahone1008/STechbaza-iot/commit/8a6af14435e9663b2026a36c59288d2ca4024b4a).

| Gate | Результат |
|---|---|
| OpenAPI generation | Zero-diff, 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Vitest | **31 passed** |
| Mocked Chromium | **40 passed** |
| Затриманий перехід після login/refresh | **10 passed**, по 5 повторів кожного сценарію, `--retries=0` |
| Live Chromium / справжній backend | **10 passed**, включно з login test, що впав у Windows |
| Повторний Windows-прогін | **31 unit / 40 mocked / 10 live — PASS**; решта ручних сценаріїв очікують підтвердження |

Jobs: `frontend` — `108948303956`, `auth-live` — `108949425836`.
Failed/flaky tests немає. Цей documentation commit фіксує результати
перевіреної code revision. Повторний Windows-прогін підтверджено нижче.

## Повторний Windows-прогін і видимий UI, 28.09.2026

13 скриншотів користувача (16:35–16:40 Europe/Kyiv) підтверджують:

- `git pull --ff-only origin main`: `14c096b` → `4ad086f`;
- `check-stage11-op1-op2.ps1 -Start`: OpenAPI 0.38.0 / 47 paths,
  typecheck, lint, production build, **31 unit / 40 mocked / 10 live — PASS**;
- фінальний `PASS: Stage 11.1-11.2`; Next.js Ready на `127.0.0.1:3000`;
- PostgreSQL, Mosquitto й backend Healthy; demo data/passwords збережено;
- екран перевірки профілю змінився завантаженим списком пристроїв;
- у списку п’ять пристроїв, breadcrumbs організації/об’єкта, UID,
  lifecycle, час перевірки та останнього зв’язку; є Online, Offline
  і «Ще не було зв’язку»;
- каталог організацій містить доступну demo-організацію; сесія відновлена.

Ці зображення не підтверджують окремо ручне відкриття картки пристрою,
натискання оновлення зв’язку, F5/відновлення вибору, вузький екран чи logout
у двох вкладках. Автотести відповідних сценаріїв пройшли; ручні перевірки
ще потребують підтвердження користувача. Прогрес приймання залишається 8/24.

У консолі є попередження npm щодо deprecated ESLint та install script
`unrs-resolver`, а також LF/CRLF; вони не зупинили перевірки. Рядок підказки
старого gate 10.2 має пошкоджене відображення кирилиці. Це окремі питання
обслуговування tooling/консольного тексту; збою login у повторному прогоні немає.

## Докази початкової реалізації до Windows-виправлення

| Gate | Результат |
|---|---|
| OpenAPI | 0.38.0 / 47 paths, контракт не змінено |
| TypeScript strict / ESLint / production build | PASS локально та в CI |
| Vitest | **31 passed**, локально та в CI |
| Mocked Chromium | **38 passed**, без retries/flaky |
| Live Chromium | **10 passed**, без retries/flaky |
| Windows PowerShell 5.1 / ручне приймання | 31 unit / 38 mocked PASS; live 9/10, потрібен повтор після виправлення |

Повний [Frontend checks #36426003363](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36426003363)
завершився **success** для code revision
[`cf25371`](https://github.com/Mahone1008/STechbaza-iot/commit/cf253717a1df84aa63d5905c5bb3f9fef20b50e3).
Jobs: `frontend` — `108939990743`, `auth-live` — `108940915243`.
Production build, OpenAPI generation zero-diff, mock та live suites пройдено.
Попередній [прогін основної реалізації](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36425515807)
також успішний: 31 / 37 / 10; фінальна версія додала mobile inventory regression.
Окремий наступний documentation commit лише фіксує ці докази.

Локальне середовище не має Docker/PowerShell і придатного Chromium;
браузерні та live прогони виконуються в GitHub Actions. Backend executable
code і міграції не змінені; останній повний backend CI наведений в
[огляді після Етапу 10](project-review-after-stage10-2026-09-28.md).

## Остаточне приймання

28.09.2026 після наведених скриншотів користувач підтвердив решту ручних
сценаріїв повідомленням «Работает» і доручив перейти одразу до 11.3/11.4.
11.1/11.2 прийнято; прогрес **10/24**. Попередні згадки про очікування вище
описують історію перевірок до цього підтвердження.
