# Досьє V3.5 — Етап 13

## Аварії, підтвердження оператора, повідомлення та наскрізний інцидент KERUMO

Дата фіксації: **29.09.2026, Europe/Kyiv**. Реалізація та наведені CI/Windows
прогони — **28.09.2026**. Backend base: **0.38.0 / 47 paths / 17 migrations**.

**Реалізовано 4/4 операції. Фінальний frontend CI: 83 unit / 133 mocked /
10 live та 44 додаткові повтори — PASS. Windows: 133 mocked / 10 live /
cumulative gate — PASS.** Перевірено реальний MQTT flow із demo simulator.
Ручне приймання часткове; досьє не закриває непоказані взаємодії.
Прийнятий frontend roadmap залишається **10/24**.

## 1. Мета і результат

Етап 13 замінив демонстраційний розділ аварій даними backend і додав
персональну стрічку повідомлень. Оператор може простежити інцидент від
виникнення до усунення, підтвердити його отримання й побачити автора дії.
Прочитання повідомлень зберігається окремо для кожного користувача.

| Операція | Реалізований результат | Докази та приймання |
|---|---|---|
| 13.1 — Аварії | Вибір пристрою, фільтри, важливість, active/resolved, деталі й transitions | CI та Windows PASS; список, деталі та згортання показані |
| 13.2 — Acknowledge | Permissions, діалог, один POST, автор, ідемпотентність і concurrent resolution | CI та Windows PASS; результат owner ACK видно в історії, ручна дія окремо не показана |
| 13.3 — Повідомлення | Стрічка організації, unread count, personal read, snapshot і tenant isolation | CI та Windows PASS; feed і unread recovery показані |
| 13.4 — Наскрізний інцидент | MQTT → telemetry → rule → alarm → notification → personal read → ACK → recovery | CI та Windows live PASS; фінальна історія інциденту показана |

Деталі операцій: [13.1](stage-13-op1-alarms.md),
[13.2](stage-13-op2-acknowledgement.md),
[13.3](stage-13-op3-notifications.md), [13.4](stage-13-op4-incident-e2e.md).

## 2. Стани й дії, які не слід змішувати

| Поняття | Що означає |
|---|---|
| Важливість warning/critical | Серйозність інциденту; не визначає, чи його підтверджено або усунено |
| Active / resolved | Чи зафіксував backend чинну причину аварії або її усунення |
| Acknowledge оператором | Оператор побачив інцидент; зберігаються перший автор і час |
| Personal read | Конкретний користувач позначив notification прочитаним |
| Notification kind | Подія на момент створення: raised, severity_changed або resolved |

Підтвердження оператором не усуває причину і не надсилає команду пристрою.
Прочитання notification не підтверджує аварію та не змінює read_at іншої
людини. Усунений без підтвердження incident — допустимий стан.
Старе raised notification залишається історичною подією після recovery.
У UI немає ручної кнопки resolve. MQTT ACK команди з Етапу 12 — окреме
поняття, не підтвердження аварії оператором.

## 3. Маршрути, API та межі доступу

| Сторінка | Призначення |
|---|---|
| `/alarms` | Вибір пристрою поточного об’єкта |
| `/alarms/devices/{deviceId}` | Аварії одного пристрою |
| `/alarms/devices/{deviceId}/{alarmId}` | Поточний стан та історія інциденту |
| `/notifications` | Стрічка підтвердженої поточної організації |
| `/organizations/{organizationId}/notifications` | Явний маршрут стрічки організації |
| `/organizations/{organizationId}/notifications/{notificationId}` | Snapshot повідомлення та personal read |

Використано чинні backend endpoints, без нових paths або міграцій:

| Метод і шлях, префікс `/api/v1` | Призначення |
|---|---|
| GET `/devices/{id}/alarms` | Список із серверними фільтрами |
| GET `/alarms/{id}` | Деталі інциденту |
| GET `/alarms/{id}/transitions` | Історія переходів |
| POST `/alarms/{id}/acknowledge` | Підтвердження оператором |
| GET `/organizations/{id}/notifications` | Стрічка організації |
| GET `/organizations/{id}/notifications/unread-count` | Непрочитані поточного користувача |
| GET `/notifications/{id}` | Snapshot та особистий read_at |
| POST `/notifications/{id}/read` | Явна відмітка прочитання |

Route guards вимагають `alarm.read` або `notification.read`; кнопка ACK —
`alarm.acknowledge`. Viewer може читати повідомлення і позначати їх
прочитаними, але не підтверджувати аварії. Посилання з notification до
incident доступне з `alarm.read`. Backend перевіряє права на кожному запиті.

UUID, device → site → organization та повернені IDs перевіряються до показу
даних. Parsers перевіряють enums, час, nullable fields, дублікати, межі
сторінки й відповідність tenant. Cache keys розділені за user/session та
ресурсним контекстом. Зміна організації, logout і навігація прибирають старий
контекст; довільний текст і JSON виводяться через escaped React content.
Типи аварій не обмежені жорстко заданим набором датчиків.

## 4. Список аварій, історія та політика запитів

Фільтри: active/resolved/усі, warning/critical/усі та точний `alarm_type`
до 96 символів. Тип застосовується кнопкою; запит на кожне натискання
клавіші не виконується. Зміна фільтра скасовує попередній запит і повертає
першу сторінку. Порожній результат показується явно.

Деталі містять перше/останнє спрацювання, occurrence_count, час усунення
та підтвердження, автора і context. Transitions завантажуються після
перевірених деталей та показують raised/repeated/acknowledged/resolved/
reopened/severity_changed, from/to state, reason, автора й data.
Час аварій показано у timezone об’єкта з UTC fallback.

Списки пристроїв, аварій, transitions і notifications обмежені: запит 21
запису, показ 20, offset=page×20. Це не snapshot pagination: нові події та
зміни стану можуть пересувати межі сторінок. Ручне оновлення повертає першу
сторінку; перевірка стану incident повертає його history на першу сторінку.

Немає запитів аварій усіх пристроїв або вигаданого глобального total.
Списки та деталі оновлюються явно, без фонового polling. Спільна query policy:
timeout 10 с, query retry=false, Retry-After для ручного повтору, gcTime=0,
abort при hidden/offline/navigation/logout. Чинний auth adapter може один
раз повторити GET після refresh; для POST це вимкнено.

Loading/error приховує старі дані. StableRegion утримує геометрію під час
завантаження; явне згортання технічних деталей звільняє місце. Втрата
доступу 401/403/404 у transitions приховує також snapshot інциденту до
повторної перевірки доступу.

## 5. Підтвердження оператором і поведінка при збоях

ACK доступний для active/unacknowledged incident після успішного GET,
за належних прав у видимій online-вкладці. Діалог показує пристрій та аварію.
Синхронний guard блокує подвійний POST. Після відповіді перечитуються стан
та history; optimistic success немає.

Backend серіалізує acknowledge і resolution через device lock. Перший actor
snapshot зберігається; повторний POST повертає наявний результат. Окремий
request_id для ACK не потрібен за чинним контрактом: ідемпотентність
визначається alarm ID і збереженим підтвердженням. Якщо інший оператор був
першим, UI показує його автора, а не підставляє поточного користувача.

| Результат POST | Поведінка UI |
|---|---|
| Успіх | Перевірка IDs/acknowledged_at, нові GET стану та history |
| 409 при concurrent resolution | Перечитування фактичного стану; resolved без ACK не стає підтвердженим |
| Network/timeout/5xx/invalid receipt | Результат невідомий; нова спроба лише після успішного GET і явного підтвердження |
| 429 | Додаткове очікування Retry-After, навіть після GET; таймер не надсилає POST |
| 401/403/404 | Snapshot та history приховано до перевірки доступу |

Автоматичних повторів POST немає, включно з 401. Pending intent не
зберігається; F5/reconnect не відтворюють дію. Abort припиняє очікування,
але не гарантує скасування вже прийнятого сервером запису.

## 6. Стрічка організації та персональне прочитання

Feed виконує два GET: обмежений список і unread count. Якщо один завершується
помилкою, обидві частини приховані; помилка count не підміняється нулем.
Це окремі серверні reads, тому під час нових подій вони можуть відрізнятися.
Немає фонового badge polling або fan-out по пристроях.

Фільтр «Усі» / «Непрочитані мною» передає `unread_only`. Зміна фільтра та
оновлення повертають першу сторінку. Count стосується всіх непрочитаних
користувача в організації, а не поточної сторінки чи активних аварій.

Snapshot містить title/description, kind, severity, час події/створення
і personal read_at. Час явно позначено UTC, оскільки стрічка охоплює різні
об’єкти. Поточний стан доступний у пов’язаному incident; технічні IDs згорнуті.

Відкриття картки нічого не позначає прочитаним. Кнопка виконує один POST
`/notifications/{id}/read`; backend зберігає перший read_at за парою
notification/user. Receipt перевіряється за ID і часом, потім виконується
свіжий GET. При поверненні у feed count запитується заново.

Read має окремий guard проти double click, timeout 10 с, без optimistic
read/count і автоматичного replay. Невизначений результат потребує GET
перед ручним повтором; 429 зберігає cooldown після GET. 401/403/404 приховує
snapshot і посилання до incident. Hidden/offline/logout/unmount скасовують
transport; read intent не переживає F5.

## 7. Наскрізний MQTT incident — що саме доведено

Операція 13.2 використовує guarded fixture `demo.frontend.acknowledgement`
через lifecycle service для перевірки browser ACK. Вона не є доказом MQTT
rule flow. Операція 13.4 додає окремий реальний шлях: simulator → Mosquitto →
backend → PostgreSQL → browser; інцидент не створюється прямим записом у БД.

1. TB-DEMO-PRESSURE повертається у normal; очікується свіжа telemetry без
   active `demo.pressure.low`.
2. MQTT scenario переключає simulator у alarm: pressure.bar=0.4, low threshold
   1.0, clear threshold 1.5, debounce 2. Helper перевіряє telemetry → event →
   transition → notification та їхні пов’язані IDs.
3. Owner читає raised notification у browser, перевіряє count і read_at після
   F5. Incident залишається active без ACK.
4. Viewer в окремій session бачить те саме повідомлення непрочитаним і може
   прочитати його; кнопки ACK у нього немає.
5. Owner підтверджує incident через діалог. Автор зберігається, стан active.
6. MQTT normal усуває причину. Той самий incident стає resolved зі збереженим
   ACK; з’являється окреме unread recovery notification.
7. Browser перевіряє три transitions, автора після F5, незмінний raised/read
   snapshot та unread filter. Для цього incident рівно два notifications:
   raised і resolved; ACK не створює notification.

Helper працює лише з явним `KERUMO_RUN_NOTIFICATION_DEMO=1`, API
`http://127.0.0.1:8001` і compose project `techbaza-demo` або `techbaza-auth-ci`.
Перевіряються demo mode, БД, фіксований pressure device/site, enabled module
та початкова PRESSURE_CONFIG. Змінена конфігурація зупиняє сценарій без
перезапису. SQL використовується для читання доказів; scenario йде через MQTT.
У `finally` закривається viewer context і відновлюється normal, історія лишається.

| Доказ | Фінальний CI | Windows користувача |
|---|---|---|
| Alarm ID, незмінний при recovery | `0f739a16-54b2-4270-900b-3d1ccb70dfab` | `d7b40cbc-b4b6-4638-b5c0-59fcc698d446` |
| Pressure raised → recovery | 0.4 → 2.484 bar | 0.4 → 2.447 bar |
| Sequence в межах своєї simulator session | 20 → 26 | 22 → 28 |
| State / acknowledged | active / false → resolved / true | active / false → resolved / true |

Пов’язані notification/message IDs і докладні докази наведені в [13.4](stage-13-op4-incident-e2e.md).
CI demo після тесту прибрано штатно; Windows demo зберігає історію.
Новий сценарій не командує насосом. Успадкований cumulative suite окремо
перевіряє Stop ізольованого TB-DEMO-PUMP simulator.

## 8. Перевірки, revisions та виправлення

Фінальна code revision: [`d7d9f2a`](https://github.com/Mahone1008/STechbaza-iot/commit/d7d9f2a025c57312532c593f9682b0e3d37f5669).
[Frontend checks #36478571392](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36478571392)
— **completed/success**; frontend job `109118316921`, live job `109120869889`.
Числа нижче стосуються повних cumulative suites, а не лише Етапу 13.

| Перевірка | Результат |
|---|---|
| OpenAPI generation / zero diff / verify | PASS; 0.38.0 / 47 paths |
| TypeScript strict / ESLint / production build | PASS |
| Unit/component | 83 PASS у 15 файлах |
| Mocked Chromium | 133 PASS у 13 файлах за 3.6 хв |
| Додаткові повтори, retries=0 | 44 PASS: 10 login + 15 overview + 9 polling + 10 ACK/read 429 |
| Live Chromium | 10 PASS за 58.3 с; real backend/MQTT, owner/viewer reads, ACK/recovery |
| Failed/flaky фінального прогону | 0 |
| Windows 13.1–13.2 | 75 unit / 115 mocked / 10 live / cumulative gate PASS на `b5b400c` |
| Windows 13.3–13.4 | 133 mocked за 3.9 хв / 10 live за 1.0 хв / cumulative gate PASS |

Етап додав 7 alarm і 8 notification unit tests, 24 alarm та 18 notification
mocked scenarios. Live count залишився 10: наявні тести розширено, а не
зараховано як нові. Покрито чужі IDs/tenant, permissions, фільтри/сторінки,
empty/error, escaping/mobile, double click, невизначені записи, 401/403/404,
409/429, F5, offline/reconnect та запізнілі відповіді.

Backend application code, API й migrations у Етапі 13 не змінювалися.
Повний backend suite тут повторно не заявляється; 160 tests без skips із
[досьє Етапу 12](dossier-v3.5-stage-12-telemetry-commands.md) — попередній доказ.

| Крок | Результат |
|---|---|
| 13.1–13.2, `e9c0009` | [CI #36470368112](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36470368112): 75/115/10 + 34 повтори PASS |
| `b5b400c` | Документаційна фіксація CI; Windows 75/115/10 PASS |
| `e7001d7` | Windows-докази та ASCII-підказка замість пошкодженого тексту PowerShell; [повторний CI #36475200215](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36475200215): 114 mocked PASS, один ACK 429 failure, live skipped |
| 13.3–13.4, `d7d9f2a` | Notification feed, MQTT E2E і корекція порядку тестового clock; фінальний CI 83/133/10 + 44 повтори PASS |
| `33fba93` → `26d8f02` | Документаційні CI/Windows-докази; виконуваний код не змінено |

Причина нестабільного 429 тесту: `clock.fastForward(11000)` міг виконатися
до завершення GET reconciliation та спрацювати на його timeout. Додано явне
очікування завершеного GET перед переводом годинника, також для notification
429. Обидва сценарії пройшли основний набір і по п’ять додаткових CI повторів;
production Retry-After policy не змінена.

ASCII-підказка `session restored; demo data` у Windows PowerShell тепер
читабельна на скриншоті 205445. Український web UI збережено. Це досьє —
документаційне доповнення; воно не є новим прогоном тестів.

## 9. Windows, видимий результат і ручне приймання

Перша серія містить 12 скриншотів 192525–194556, друга — 11 скриншотів
205306–205855 від 28.09.2026. Оригінальні зображення не комітяться;
їхні суфікси та спостереження збережені в [13.2](stage-13-op2-acknowledgement.md)
і [13.4](stage-13-op4-incident-e2e.md).

Підтверджено запуск Windows wrappers, healthy demo containers, збереження
даних/credentials, live MQTT proof та готовий frontend на 127.0.0.1:3000.
Для другої серії точний git HEAD і окремий unit-підсумок у кадрах відсутні:
команда надавалася після `33fba93`, але це не доказ встановленого SHA.
Число 83 unit належить CI; Windows unit успішність входить у cumulative gate.

| UI-доказ | Що видно |
|---|---|
| Аварії TB-DEMO-PUMP | Фільтр «Усунені», окремі badges, деталі device.reboot, системна історія; згортання звільняє місце |
| Feed DEMO: клієнт A | «Усі», 159 непрочитаних, raised/read і recovery/unread, відновлена session |
| Recovery notification | «Причину усунено», досі unread, явна кнопка прочитання, посилання до incident, згорнуті технічні деталі |
| Pressure incident | Resolved + acknowledged, DEMO: owner і raised → acknowledged → resolved у history |

159 — накопичений unread count, а не активні аварії. На повідомленні
20:52:43 UTC та в incident 23:52:43 за часом об’єкта позначають ту саму подію;
різниця у три години не є затримкою доставки.

Live E2E уже створив read/ACK records, тому показ фінального стану не
засвідчує виконання відповідних ручних кліків. Окремо залишаються:

1. Усі alarm filters, точний тип, empty state, paging та ручне оновлення.
2. Cancel/confirm на активному demo incident; перевірка першого автора
   й active після ACK, збереження після F5.
3. Ручний notification read, зміна count, unread filter, paging та F5;
   відкриття raised і recovery snapshots того самого incident.
4. Незалежний personal read owner/viewer і відсутність ACK у viewer.
5. Mobile/keyboard, розгортання/згортання, зміна tenant/device, logout,
   offline/reconnect без старих даних і повторного POST.

Автоматичні сценарії пройдено; ця таблиця не підміняє ручного приймання.
Відкриті пункти попередніх етапів зберігаються у відповідних досьє.

## 10. Відтворення, файли та наступна точка

Для повторного повного Windows gate запустити Docker Desktop, зупинити
попередній frontend через Ctrl+C і виконати весь блок у PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage13-op3-op4.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 13 verification failed.' }
}
```

Wrapper включає попередні cumulative checks, відновлює environment variables
і запускає frontend через npm.cmd після PASS. Volumes і паролі не видаляються.
Вхід: `http://127.0.0.1:3000/login`, чинні demo credentials. Додавання цього
досьє саме по собі не потребує повторного повного запуску.

| Ділянка реалізації | Основні файли |
|---|---|
| Runtime API contracts | `frontend/src/lib/api/alarms.ts`, `notifications.ts` та їхні unit tests |
| Alarm UI / ACK | `frontend/src/features/alarms.tsx`, `alarm-detail.tsx`, `alarm-shared.tsx`, `use-alarm-acknowledgement.ts` |
| Notification UI / read | `frontend/src/features/notifications.tsx`, `notification-detail.tsx`, `notification-shared.tsx`, `use-notification-read.ts` |
| Mocked regression | `frontend/tests/browser/alarms.spec.ts`, `notifications.spec.ts` |
| Live scenario | `frontend/tests/browser/inventory.live.spec.ts`, `frontend/tests/helpers/notification-incident.ts` |
| Demo / Windows | `scripts/prepare-stage13-demo.py`, `stage13-mqtt-scenario.py`, `check-stage13-op1-op2.ps1`, `check-stage13-op3-op4.ps1` |
| CI | `.github/workflows/frontend-bootstrap.yml` |

Не входять у цей етап: глобальна агрегація аварій, rule editor, export,
read-all, push/email/SMS, background badge, WebSocket і MQTT у браузері.
Browser спілкується з HTTP API, а MQTT використовується між simulator,
broker і backend. Фізичні ESP32/VFD та навантаження 10 000 контролерів цими
перевірками не охоплені; production readiness потребує окремих доказів.

Наступні дві операції roadmap: **14.1 — UX/accessibility** та
**14.2 — browser regression**. Їхню реалізацію це досьє не засвідчує.

- [Frontend roadmap](frontend-roadmap-v1.md)
- [Досьє V3.5 — Етап 12](dossier-v3.5-stage-12-telemetry-commands.md)
- [13.1 — аварії](stage-13-op1-alarms.md)
- [13.2 — acknowledge](stage-13-op2-acknowledgement.md)
- [13.3 — notifications](stage-13-op3-notifications.md)
- [13.4 — MQTT E2E та докази](stage-13-op4-incident-e2e.md)
- [Frontend API contract](frontend-api-contract-v1.md)
- [RBAC і multi-tenant guards](rbac-multitenant-guards-v1.md)
- [Demo stand](demo-stand-v1.md)
- [Індекс документації](README.md)
