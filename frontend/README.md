# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT identifiers TechBaza поки зберігаються для сумісності
з прийнятим backend 0.38.0.

## Поточний стан

**14.1–14.2 реалізовано:** UX/accessibility, keyboard, responsive tables,
axe scans, owner/viewer journeys та two-tenant/two-tab regression.
Локально 83 unit, types/lint/build PASS; фінальний CI та Windows очікуються.
[Перевірки та Windows-команда](../docs/stage-14-op2-browser-regression.md).

**Етапи 9 і 10 завершено по 4/4. Frontend roadmap: прийнято 10/24.
Етапи 11 і 12 реалізовано по 4/4; залишок ручного приймання зафіксовано в досьє.**

- **9.1–9.4 закрито:** UX, Next.js/TypeScript foundation, OpenAPI/API layer,
  unit/component tests, Chromium smoke, production build і Windows acceptance.
- **10.1 закрито:** real FastAPI browser login із CSRF, HttpOnly refresh cookie,
  memory-only access token і auth error states.
- **10.2 закрито:** F5 recovery, proactive refresh, single-flight та
  coordination між same-origin вкладками.
- **10.3 закрито:** `/auth/me`, visible organizations, organization access,
  runtime permission registry, session-scoped cache, route guards і
  permission-aware controls.
- **10.4 закрито 27.09.2026:** real browser logout, server-side revoke,
  cross-tab cleanup, abort pending requests, logout failure/retry states,
  no session resurrection і фінальне Windows-приймання.
- **11.1 і 11.2 прийнято:** реальні org/site/device API, context restore,
  pagination і bounded presence; CI та Windows PASS.
- **11.3 і 11.4 реалізовано:** модульний overview, якість телеметрії та зміни
  конфігурації; CI та Windows PASS, окремі ручні сценарії відкриті.
- **12.1–12.4 реалізовано:** реальна історія, bounded polling, фільтри після F5,
  підтверджувані команди, lifecycle і журнал. Фінальний CI: **68 unit /
  91 mocked / 10 live + 34 повтори PASS**. Windows бази 12.3–12.4: **88 mocked /
  10 live / cumulative gate PASS**; ручне приймання останнього виправлення
  згортання та решти сценаріїв відкрите.
- **13.3–13.4 реалізовано:** notification feed, count, personal read і browser MQTT incident/recovery; [перевірки й запуск](../docs/stage-13-op4-incident-e2e.md).
- **13.1–13.2 реалізовано:** real alarms, фільтри, transitions і acknowledge.
  Локально 75 unit, types/lint/build PASS; CI та Windows-докази — у
  [документі 13.2](../docs/stage-13-op2-acknowledgement.md). Приймання відкрите.
- `/ui-kit/device-demo` залишається демонстраційним макетом.

- [Досьє V3.5 — Етап 9](../docs/dossier-v3.5-stage-9-frontend-foundation.md).
- [Досьє V3.5 — Етап 10](../docs/dossier-v3.5-stage-10-browser-auth-session-rbac.md).
- [Досьє V3.5 — Етап 11](../docs/dossier-v3.5-stage-11-inventory-modular-dashboard.md).
- [Досьє V3.5 — Етап 12](../docs/dossier-v3.5-stage-12-telemetry-commands.md).
- [Досьє операції 10.1](../docs/stage-10-op1-browser-login.md).
- [Досьє операції 10.2](../docs/stage-10-op2-session-recovery.md).
- [Досьє операції 10.3](../docs/stage-10-op3-permissions-and-guards.md).
- [Досьє операції 10.4](../docs/stage-10-op4-logout-and-failures.md).

## Стек

- Next.js 16.3.6, App Router;
- React / React DOM 19.2.8;
- TypeScript strict;
- TanStack Query 5.104.0;
- OpenAPI TypeScript 7.13.0;
- Vitest 5.0.2;
- Playwright 1.63.0, Chromium;
- CSS variables + звичайний CSS;
- ESLint flat config із core-web-vitals і TypeScript rules.

Node.js: **20.9.0+**. CI: Node.js 22.16.0. Локально прийняті Етап 9 та
операції 10.1–10.3 на Node.js 24.21.0.

## Конфігурація

```powershell
Copy-Item .env.example .env.local
```

Public settings:

```text
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_API_TIMEOUT_MS=10000
```

Не додавати secrets у `NEXT_PUBLIC_*`: ці values потрапляють до browser bundle.

## Перевірка 11.1 і 11.2

Зупинити Next.js через `Ctrl+C`, залишити Docker Desktop у Linux containers
mode і з кореня repository виконати:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage11-op1-op2.ps1 -Start
```

Gate запускає всі актуальні suites; credentials і volumes зберігаються.
Після PASS UI: <http://127.0.0.1:3000/login>.

[11.1 — поведінка й контекст](../docs/stage-11-op1-organizations-sites.md).

[11.2 — докази CI та ручне приймання](../docs/stage-11-op2-device-list.md).


## Маршрути

- `/login` — browser login, session recovery, logout notice і safe local `returnTo`;
- `/organizations` — paginated каталог організацій;
- `/organizations/{id}/sites` — об’єкти;
- `/organizations/{id}/sites/{siteId}/devices` — реальні пристрої;
- `/devices` — підтверджений поточний site context;
- `/devices/{UUID}` — модульний overview, історія, bounded polling, керування та журнал команд;
- `/ui-kit/device-demo` — явно позначений demo dashboard;
- `/alarms` — вибір пристрою для перегляду аварій;
- `/alarms/devices/{UUID}` — реальні аварії, server filters і pagination;
- `/alarms/devices/{UUID}/{alarmId}` — incident, transitions і acknowledge;
- `/ui-kit` — protected components і real `/health` panel.

Route permissions:

```text
/organizations → authenticated catalog
/organizations/{id}/sites → site.read
/organizations/{id}/sites/{siteId}/devices → device.read
/devices* → device.read
/alarms*  → alarm.read
/ui-kit*  → capability.read
```

Frontend guard покращує UX і не замінює backend authorization.

## OpenAPI

Backend snapshot: `src/lib/api/openapi.json`.  
Generated TypeScript: `src/lib/api/schema.d.ts`.

Regeneration після зміни backend contract:

```powershell
.\.venv\Scripts\python.exe ..\scripts\export_openapi.py
npm.cmd run api:generate
npm.cmd run api:verify
```

CI повторює generation і вимагає zero diff. Етап 10 завершено 4/4.
11.1/11.2 прийнято; 11.3/11.4 мають CI та Windows PASS із залишком ручних сценаріїв.
Історія та фільтри — [12.1 історія](../docs/stage-12-op1-telemetry-history.md)
та [12.2 polling/перевірки](../docs/stage-12-op2-polling.md).
Спільна Windows-команда з кореня репозиторію:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage12-op3-op4.ps1 -Start
```

## Команди та журнал (12.3–12.4)

[Керування](../docs/stage-12-op3-command-controls.md),
[lifecycle, перевірки та запуск Windows](../docs/stage-12-op4-command-journal.md).
`check-stage12-op3-op4.ps1 -Start` виконує cumulative gate. Live suite
з `KERUMO_RUN_COMMAND_DEMO=1` надсилає Stop лише localhost TB-DEMO-PUMP simulator.
Без opt-in live suite не надсилає команд. POST не повторюється автоматично.

## Аварії та підтвердження (13.1–13.2)

[Аварії](../docs/stage-13-op1-alarms.md),
[acknowledge, результати й Windows](../docs/stage-13-op2-acknowledgement.md).
Актуальний cumulative gate з кореня репозиторію:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage13-op1-op2.ps1 -Start
```

Wrapper явно вмикає `KERUMO_RUN_ALARM_DEMO=1` і готує guarded fixture лише
в techbaza_demo. Live suite підтверджує цей тестовий incident через UI;
acknowledge не змінює стан обладнання. Чинний command demo opt-in збережено.

## Повідомлення та MQTT incident (13.3–13.4)

`/notifications` і `/organizations/{id}/notifications[/{notificationId}]`
підключені до реального API. Персональний read не виконує alarm ACK/resolve.
Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage13-op3-op4.ps1 -Start` із кореня репозиторію.
[13.3 — контракт і UI](../docs/stage-13-op3-notifications.md),
[13.4 — докази, межі та ручне приймання](../docs/stage-13-op4-incident-e2e.md).
