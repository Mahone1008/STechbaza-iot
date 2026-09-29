# Етап 14.2 — наскрізні browser regressions KERUMO

Дата: 29.09.2026. База: `147a10d`. Разом із [14.1 — UX/accessibility](stage-14-op1-ux-accessibility.md).
Реалізовано; **фінальний CI PASS: 83 unit / 146 mocked / 10 live + 44 повтори**.
Windows 29.09.2026: **146 mocked / 10 live / cumulative gate PASS**;
ручне приймання часткове, докази та залишок наведено нижче.

## Сценарії

`workspace-journey.spec.ts` додає три інтегровані mocked browser scenarios:

1. Owner: login → організація → об’єкт → пристрій → history filters/F5 →
   cancel команди → alarm detail → ACK зі збереженим active → notification
   read/F5/count/unread filter → logout/reload.
2. Viewer проходить той самий read path і personal read, без command/ACK
   controls або write-запитів керування.
3. Дві організації у двох вкладках: окремі history preferences, notifications
   і ACK; переходи між tenant не підміняють дані; один logout прибирає приватні
   сторінки та sessionStorage обох вкладок, deep link не відновлює session.

Stateful fixture містить різні organization/site/device/alarm/notification
IDs. Mocked tests перевіряють browser orchestration; серверна ізоляція
перевіряється окремими чинними live tests. Test data не входять у продукт.

Існуючий live two-tab logout test розширено: перед logout відкриваються
реальні notifications та alarms, після — відсутні таблиці та приватний
sessionStorage в обох вкладках. Нових login-сценаріїв або demo credentials
не додано; live count залишається 10. MQTT incident/recovery, Stop demo,
owner/viewer та foreign-tenant denial Етапів 12–13 збережені.

## Політика тестів та артефакти

Mocked suite тепер глобально має retries=0, як live suite. Нестабільність
не маскується повторним успішним виконанням. Додаткові 44 CI повтори
login/overview/polling/429 залишаються окремими перевірками.

Після основного suite CI одразу зберігає `frontend-browser-report`,
включно з axe JSON attachments у HTML report, screenshots і failure traces. Наступні повтори не
перезаписують цей artifact. Останній repeat report має окрему назву
`frontend-repeat-report`; live report лишається окремим. Retention — 5 днів.

## Фінальні докази CI

Перевірений код: [`19bb2fd152a8930ec86d5fed1fba46783c841bb3`](https://github.com/Mahone1008/STechbaza-iot/commit/19bb2fd152a8930ec86d5fed1fba46783c841bb3).
[Run #36527087657](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657) —
**completed / success**, обидва jobs успішні. Фінальне доповнення цього звіту
змінює лише root README та docs; код, залежності й workflow відповідають
перевіреному commit.

- [Frontend job #109272402093](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/job/109272402093).
- [Live job #109274417629](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/job/109274417629).
- [Основний browser/axe report](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/artifacts/11015700057), [repeat report](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/artifacts/11015406914), [live report](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/artifacts/11015467155).

| Перевірка | Результат |
|---|---|
| OpenAPI export / generation / verify | CI PASS, zero diff; 0.38.0 / 47 paths |
| TypeScript strict / ESLint | Локально та CI PASS |
| Unit/component | Локально та CI 83 PASS у 15 файлах |
| Production build | Локально та CI PASS |
| Mocked Chromium | 146 PASS у 15 файлах за 4.9 хв: 133 попередні + 10 accessibility + 3 journeys; 0 failed/flaky/skipped, retries=0 |
| Accessibility | 27 axe scans / 0 violations; 8 incomplete scan/rule pairs розглянуто в 14.1, 9 screenshots переглянуто |
| Повтори регресій | 10 login + 15 overview + 9 polling + 10 ACK/read 429 = 44 PASS, retries=0 |
| Live FastAPI/MQTT | 10 PASS за 59.7 с, retries=0; incident → notifications → owner/viewer personal read → ACK → MQTT recovery; two-tab logout PASS |
| Windows wrapper | 29.09.2026 PASS за скриншотами користувача: 146 mocked / 10 live та фінальний gate 14.1–14.2 |

У Linux-середовищі розробки встановлення Chromium і headless shell
завершилось помилкою пошкодженого ZIP із CDN; браузера та Docker там немає.
Browser/live PASS із цього середовища не заявляється; фактичний результат
підтверджено GitHub CI вище та Windows-прогоном користувача нижче.
Backend code/API/migrations не змінені,
новий повний backend suite для цієї операції не заявляється.

## Корекції за результатами CI

[`63331b8`](https://github.com/Mahone1008/STechbaza-iot/commit/63331b8c42bdf0be2bbbfe94bd4bbd3c3b618a66),
[run #36525679565](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36525679565):
140 mocked PASS, 6 failed, live skipped. Усі попередні 133 scenarios пройдено.
Нові перевірки знайшли aria-label на generic compact logo span і вихід Tab
із native modal у browser chrome. Додано role=img та замикання Tab/Shift+Tab;
focus outlines у clipped containers перенесено всередину. Два journeys
очікували графік від порожньої series fixture: fixture тепер містить валідні
зразки, assertions не послаблені.

[`b2b4279`](https://github.com/Mahone1008/STechbaza-iot/commit/b2b427981df8c2edd2aad26702ce755f84b75d15),
[run #36526330190](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36526330190):
144 mocked PASS, 2 failed, live skipped. Попередні помилки виправлені;
подальші mobile/tablet scans знайшли замалу область summary у details.
Мінімальну висоту збільшено до 44 px із вертикальними відступами.
Наступний commit `19bb2fd` пройшов повний CI, наведений вище.

## Windows-прогін користувача — 29.09.2026

Переглянуто 10 наданих скриншотів. Зафіксовано такі результати:

| Доказ | Що підтверджено |
|---|---|
| `image(20260929-055720).png`, `055748`, `055856`, `055936` | 146 mocked tests PASS за 4.2 хв, включно з 10 accessibility та 3 journeys. На `055936` також є PASS cumulative gate 9.4: clean install, API contract, unit, production build і Chromium |
| `image(20260929-055950).png`, `060003`, `060028` | Demo seed уже існує, дані й паролі збережені; PostgreSQL/Mosquitto/backend/simulator Healthy, ACK fixture підготовлено без очищення історії |
| `image(20260929-060028).png`, `060043` | MQTT telemetry → rule event → alarm → notification → personal owner/viewer reads → owner ACK → MQTT recovery PASS; загалом 10 live tests PASS за 58.7 с |
| `image(20260929-060043).png` | Фінальний `PASS: stage 14.1-14.2 accessibility, keyboard, reflow and workspace journeys`; після gate запущено `npm run dev` |
| `image(20260929-060239).png`, `060251` | Два стани історії: частота Hz та тиск bar, період 24 години й інтервал 1 година; графіки завантажені, min/max відрізки та focus outline селектора видимі |

SHA локального checkout і окремий підсумок unit tests на цих зображеннях
не показані. Прохід попередніх перевірок підтверджено cumulative PASS;
число 83 unit у таблиці CI походить із CI, а не з прочитаного Windows log.
44 додаткові repeat runs залишаються CI-доказом; окремий Windows повтор
цих груп не заявляється. Помилок у показаному прогоні немає.

Статичні screenshots графіків не доводять F5, відсутність стрибка scroll,
масштаб 200/400%, повну послідовність Tab/Shift+Tab/Escape, screen reader
або ручний cross-tab/logout. Keyboard, F5, scroll і cross-tab/logout мають
автоматичне покриття; viewport tests не є real browser zoom чи screen-reader
перевіркою. Ручне приймання нижче залишається відкритим.
Прийнятий progress 10/24 не змінено самим підтвердженням automated gate.

## Windows: команда для повторної перевірки

Docker Desktop має працювати. Попередній frontend зупинити через Ctrl+C.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage14-op1-op2.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 14 verification failed.' }
}
```

Wrapper включає cumulative 13.3–13.4, усі нові tests і guarded MQTT demo;
наявні volumes/credentials та історія зберігаються. Після PASS frontend
запускається через npm.cmd на `http://127.0.0.1:3000`.

Ручне приймання після PASS wrapper:

1. Tab/Shift+Tab → skip link → account menu; Escape повертає фокус;
   у confirmation фокус залишається всередині, скасування не надсилає дію.
2. Browser zoom 200/400% і вузьке вікно: доступні всі поля та дії;
   таблиці прокручуються всередині, focus не перекритий панелями;
   розкриття/згортання технічних деталей не залишає порожню область.
3. Owner/viewer, два tenants/tabs: F5 зберігає history filters і personal
   read; дані організацій не змішуються, logout прибирає приватний UI
   обох вкладок. Прикріпити фінальний PASS і screenshots цих станів.

Попередні непідтверджені ручні сценарії
не закриваються автоматично. Наступні операції — 14.3 security/performance
і 14.4 release/dossier; вони не виконуються в цьому блоці.
