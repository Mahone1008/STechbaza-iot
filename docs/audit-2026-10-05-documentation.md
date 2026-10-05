# Звірення документації та усунення dev-залежності — 05.10.2026

База перевірки — `main` після [PR #2](https://github.com/Mahone1008/STechbaza-iot/pull/2),
merge `3b0ecf50476dfa1a72efc0c53855283fad793167`. Поточні backend 0.45.0,
schema 0022 та firmware 0.6.0 не змінено цією роботою.

## Знайдене розходження

Документація була актуальна не повністю. Після етапу 2 й аудиту якості
залишилися старі версії, навігація та backlog, що вже не відповідав коду.

| Область | Виправлення |
|---|---|
| Поточний статус і плани | Етап 2 позначено частково виконаним; CODE-01 містить виконані зміни й залишок Python CVE gate; production/hardware acceptance не оголошено завершеним |
| Buyer/factory/account | Додано чинний контракт реєстрації, recovery, TOTP, сесій, factory, claim, паспорта й bootstrap contact; перелічено незавершені фізичні кроки |
| RBAC і demo accounts | Описано `site_ids`/`expires_at`, MFA policy та вимогу MFA для factory навіть локально |
| UI і календар | Документи ведуть до п'яти розділів; календар — окрема вкладка, паспорт/діагностика — в «Обладнанні» |
| Оновлення й backup | Звірено версії 0.45.0/0022/0.6.0, manifest backup і NVS; додано посилання на обов'язкове перенесення account key |
| Команди й довідник | Legacy v2 відрізнено від managed v3; перелік прямих команд відрізнено від scheduler-only `vfd.schedule.start`; виправлено джерело генерації довідника |
| Архітектура й перевірки | Зафіксовано MQTT/account/session та NVS/Modbus modules, Python locks/Ruff/поступовий mypy, форматування й dependency gate |

Чинні README, контракти та runbooks звірено з API/schemas/services,
frontend routes/components, firmware, Compose та workflows. Для всіх
Markdown-файлів виконано перевірку локальних file links. Історичні досьє,
SHA, числа тестів і докази оператора збережено як результати своїх дат;
старі PowerShell-процедури в чинних контрактах явно позначено історичними.
Зовнішні URL, anchors і фізичні вимірювання автоматичний docs gate не перевіряє.

## Уразливість залежності

[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
описує stack exhaustion у `braces <=3.0.3`. Advisory опубліковано 18.09,
GitHub reviewed — 02.10; залежність була в проекті від lock commit
`2610a74` 27.09, до аудиту й PR #2. Виправленого upstream `braces` на дату
перевірки немає.

Вразливий dev-ланцюжок видалено scoped npm override для
`@next/eslint-plugin-next@16.3.6`: його єдиний glob caller тепер отримує
`glob@13.0.6` через npm alias. Next/ESLint rules не вимкнено; runtime
dependencies застосунку не змінено. Повний lock більше не містить
`braces`/`micromatch`. Сумісність перевіряє справжній Next ESLint rule,
включно з relative/absolute roots, поточним каталогом, wildcard/brace
patterns, масивом каталогів, Windows separators і стороннім файлом у glob.
Межі alias та процедура наступного оновлення — у [стандартах](development-standards.md).

## Перевірки цієї зміни

| Перевірка | Результат |
|---|---|
| Чисте встановлення `npm ci` | PASS; alias відновлюється з lock |
| Повний `npm audit --audit-level=high` | 0 відомих уразливостей, включно з dev |
| `npm audit --omit=dev` | 0 відомих уразливостей |
| OpenAPI verify / TypeScript / ESLint / format gate | PASS |
| Vitest | 122 PASS |
| Next ESLint compatibility regressions | 8 PASS |
| Окрема перевірка вкладеного шаблону | 10 000 вкладених пар braces у subprocess: 0 matches, без RangeError/timeout |
| Mocked Chromium browser suite | 220 PASS, без пропусків |
| Документація / equipment catalog | PASS; довідник з коду, локальні file links у 117 Markdown files, profile/firmware hash |
| Production build / bundle budget | PASS; 319636 / 358400 gzip bytes, найбільший chunk 71628 / 122880 |

Зміна dependency lock і compatibility tests: commit `27a8e93`.

GitHub Actions на `bbd9c1c3427b0f9d6a6a482ae2fbf3f66c085a40`:
[frontend, повний audit і live API/MQTT — PASS](https://github.com/Mahone1008/STechbaza-iot/actions/runs/37277057681),
[firmware/gateway — PASS](https://github.com/Mahone1008/STechbaza-iot/actions/runs/37277057698),
[документація — PASS](https://github.com/Mahone1008/STechbaza-iot/actions/runs/37277057738).
Наступне уточнення цього звіту й відкритих питань змінює лише Markdown;
виконуваний код і dependency lock відповідають перевіреній ревізії.

Попередній аудит backend/firmware має окремі докази PR #2:
[backend CI](https://github.com/Mahone1008/STechbaza-iot/actions/runs/37272950837)
(259 tests без skips, PostgreSQL/MQTT/restore),
[firmware CI](https://github.com/Mahone1008/STechbaza-iot/actions/runs/37272950826)
(native sanitizers і ESP32 builds). Ці результати не видано за новий
запуск у межах зміни документації.
Нові hardware tests, розгортання на стенді або перепрошивання не виконувалися.

## Де продовжити

[Етап 2](next-stage-plan-vfd-service-qr.md): QR-друк, Wi-Fi setup з телефона,
firmware bootstrap і MQTT identity, commissioning/readback, rotation/revocation,
передача/повернення/reset та наскрізне приймання покупця. Далі — узгоджені
етапи 3–5. PROGRAM-01, SCHEDULE-01, fault/soak та production-пункти лишаються
відкритими в [єдиному реєстрі стану](project-status.md).
