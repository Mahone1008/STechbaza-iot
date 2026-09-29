# Етап 14.2 — наскрізні browser regressions KERUMO

Дата: 29.09.2026. База: `147a10d`. Разом із [14.1 — UX/accessibility](stage-14-op1-ux-accessibility.md).
Реалізовано; локальні перевірки PASS. Фінальний CI та Windows/manual очікуються.

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
включно з axe JSON, screenshots і failure traces. Наступні повтори не
перезаписують цей artifact. Останній repeat report має окрему назву
`frontend-repeat-report`; live report лишається окремим. Retention — 5 днів.

## Перевірки на поточному кроці

| Перевірка | Результат |
|---|---|
| OpenAPI verify | Локально PASS, 0.38.0 / 47 paths |
| TypeScript strict / ESLint | Локально PASS |
| Unit/component | Локально 83 PASS у 15 файлах |
| Production build | Локально PASS |
| Browser discovery | 146 тестів у 15 файлах: 133 попередні + 10 accessibility + 3 journeys; це перелік, не результат прогону |
| Windows wrapper | ASCII check PASS; Windows виконання очікується |
| Full CI / mocked / live | Очікується |

Локальне встановлення Chromium і headless shell завершилось помилкою
пошкодженого ZIP із CDN, браузера та Docker у цьому середовищі немає.
Тому локальний browser/live PASS не заявляється; фактичний результат
потрібно підтвердити повним GitHub CI. Backend code/API/migrations не змінені,
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
Повторний повний CI очікується.

## Windows: один блок

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

Ручне приймання: keyboard/focus/таблиці/zoom за 14.1, owner/viewer,
F5/read, дві вкладки та logout. Попередні непідтверджені ручні сценарії
не закриваються автоматично. Наступні операції — 14.3 security/performance
і 14.4 release/dossier; вони не виконуються в цьому блоці.
