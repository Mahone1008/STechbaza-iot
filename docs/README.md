# Документація

Документація проєкту TechBaza IoT Pump Control / KERUMO.

## Frontend

- [Досьє V3.5 — Етап 14: тестова база frontend](dossier-v3.5-stage-14-frontend-test-baseline.md)
- [14.3 — Безпека і продуктивність](stage-14-op3-security-performance.md)
- [14.4 — Перевірки тестової бази та Windows-команда](stage-14-op4-test-baseline.md)

- [14.1 — UX, доступність, keyboard і reflow](stage-14-op1-ux-accessibility.md)
- [14.2 — Browser regression, докази та Windows-команда](stage-14-op2-browser-regression.md)
- [Досьє V3.5 — Етап 13: аварії, повідомлення та наскрізний інцидент](dossier-v3.5-stage-13-alarms-notifications.md)
- [13.3 — Стрічка повідомлень і персональне прочитання](stage-13-op3-notifications.md)
- [13.4 — Browser MQTT incident E2E, перевірки та Windows-команда](stage-13-op4-incident-e2e.md)

- [13.1 — Реальні аварії, фільтри та історія](stage-13-op1-alarms.md)
- [13.2 — Acknowledge, перевірки та Windows-команда](stage-13-op2-acknowledgement.md)
- [Досьє V3.5 — Етап 12: графіки, оновлення, команди та журнал](dossier-v3.5-stage-12-telemetry-commands.md)
- [12.3 — Start/Stop/frequency — CI та Windows PASS](stage-12-op3-command-controls.md)
- [12.4 — Lifecycle, аудит і журнал — CI та Windows PASS](stage-12-op4-command-journal.md)
- [Виправлення згортання деталей — CI 68/91/10 PASS](stage-12-details-collapse-2026-09-28.md)
- [Виправлення F5 — збереження фільтрів графіка](stage-12-history-preferences-2026-09-28.md)
- [12.1 — Історія телеметрії — реалізовано, CI PASS](stage-12-op1-telemetry-history.md)
- [12.2 — Політика оновлення і Windows-команда](stage-12-op2-polling.md)

- [11.1 — Організації, об’єкти та контекст — прийнято](stage-11-op1-organizations-sites.md)
- [11.2 — Пристрої та спільна перевірка — прийнято](stage-11-op2-device-list.md)

- [11.3 — Модульні віджети — CI та Windows PASS](stage-11-op3-module-widgets.md)
- [11.4 — Якість і конфігурація — CI та Windows PASS](stage-11-op4-quality-and-configuration.md)

- [Огляд після Етапу 10: поточний стан, auth-виправлення і перехід до 11.1](project-review-after-stage10-2026-09-28.md)
- [План frontend v1 — 24 операції; прийнято 10/24](frontend-roadmap-v1.md)
- [Етап 9.1 — UX-сценарії та макети KERUMO — закрито](stage-9-op1-ux-and-mockups.md)
- [Етап 9.2 — Next.js/TypeScript foundation — закрито](stage-9-op2-frontend-foundation.md)
- [Етап 9.3 — API adapter і контракти — закрито](stage-9-op3-api-adapter.md)
- [Етап 9.4 — відтворюваний frontend baseline — закрито](stage-9-op4-frontend-baseline.md)
- [Етап 10.1 — справжній browser login — закрито](stage-10-op1-browser-login.md)
- [Етап 10.2 — відновлення browser session — закрито](stage-10-op2-session-recovery.md)
- [Етап 10.3 — профіль, permissions і route guards — закрито після CI та Windows-приймання](stage-10-op3-permissions-and-guards.md)
- [Етап 10.4 — logout, revoke і захист від session resurrection — закрито після CI та Windows-приймання](stage-10-op4-logout-and-failures.md)

Поточна точка: **Етап 12 реалізовано 4/4; фінальний CI 68 unit / 91 mocked /
10 live + 34 повтори PASS, backend 160 tests без skips PASS. Windows бази
12.3–12.4: 88 mocked / 10 live / cumulative gate PASS; ручне приймання
останнього виправлення та решти сценаріїв відкрите.** Загальні докази зібрані
у досьє Етапу 12. Прийнятий прогрес — 10/24; для 11.3–11.4 також залишаються
окремі ручні сценарії. **13.1 та 13.2 реалізовано; CI 75 unit / 115 mocked /
10 live + 34 повтори — PASS**. Windows 28.09.2026: **75 unit / 115 mocked /
10 live — PASS**; список усунених аварій, деталі та згортання історії показані.
Ручне приймання часткове; докази, залишок і команда наведені в документі 13.2.
13.3 та 13.4 реалізовано; **CI 83 unit / 133 mocked / 10 live + 44 повтори —
PASS**, повний browser MQTT incident/recovery пройдено. Windows 28.09.2026:
**133 mocked / 10 live / cumulative gate PASS**; стрічка, unread recovery та
історія resolved/acknowledged показані, решта ручного приймання відкрита.
Зведений результат — у [досьє Етапу 13](dossier-v3.5-stage-13-alarms-notifications.md),
детальні докази — у 13.4. Реалізовано 14.1 та 14.2; **фінальний CI
83 unit / 146 mocked / 10 live + 44 повтори — PASS**. У 27 axe scans
немає violations; `incomplete` та ручні межі розглянуто в 14.1.
Windows 29.09.2026: **146 mocked / 10 live / cumulative gate PASS**;
показано графіки частоти/тиску та focus outline, решта ручного приймання
відкрита. Історичні докази — у 14.2.
**14.3–14.4 реалізовано як тестову базу, не production-реліз.**
Актуальні CI/виміри та команда — у [14.4](stage-14-op4-test-baseline.md),
загальний результат — у [досьє Етапу 14](dossier-v3.5-stage-14-frontend-test-baseline.md).

## Backend: виправлення та перевірки

- [Повторний огляд backend після H — оцінка, межі та backlog](backend-review-after-h-2026-09-27.md)
- [Етап H — завершено 5/5](stage-h-backend-corrections.md)
- [Hardening 25.09.2026](hardening-2026-09-25.md)

## Досьє V3.5

- [Етап 1 — Local Infrastructure](dossier-v3.5-stage-1-local-infrastructure.md)
- [Етап 2 — Backend Core](dossier-v3.5-stage-2-backend-core.md)
- [Етап 3 — Data Model v1](dossier-v3.5-stage-3-data-model.md)
- [Етап 4 — IoT Telemetry & Reliability](dossier-v3.5-stage-4-iot-telemetry-reliability.md)
- [Етап 5 — Remote Command Core](dossier-v3.5-stage-5-remote-command-core.md)
- [Етап 6 — Users, Authentication & RBAC](dossier-v3.5-stage-6-users-auth-rbac.md)
- [Етап 7 — Events & Alarms Core](dossier-v3.5-stage-7-events-alarms-core.md)
- [Етап 8 — Test backend](dossier-v3.5-stage-8-test-backend.md)
- [Етап 9 — Frontend Foundation KERUMO — загальне підсумкове досьє](dossier-v3.5-stage-9-frontend-foundation.md)
- [Етап 10 — Browser Authentication, Session Recovery, RBAC & Logout KERUMO — загальне підсумкове досьє](dossier-v3.5-stage-10-browser-auth-session-rbac.md)

- [Етап 11 — Організації, пристрої та модульна панель KERUMO — загальне досьє](dossier-v3.5-stage-11-inventory-modular-dashboard.md)
- [Етап 12 — Історія телеметрії, оновлення, команди та журнал KERUMO — загальне досьє](dossier-v3.5-stage-12-telemetry-commands.md)
- [Етап 13 — Аварії, підтвердження оператора, повідомлення та наскрізний інцидент KERUMO — загальне досьє](dossier-v3.5-stage-13-alarms-notifications.md)

## Чинні технічні контракти

- [Test backend release v1](test-backend-release-v1.md)
- [Frontend API contract](frontend-api-contract-v1.md)
- [Browser authentication](browser-auth-v1.md)
- [Current user context](current-user-context-v1.md)
- [RBAC + multi-tenant guards](rbac-multitenant-guards-v1.md)
- [Module/channel contract](module-channel-contract-v1.md)
- [Telemetry panel/charts](telemetry-panel-charts-v1.md)
- [Demo stand](demo-stand-v1.md)
- [Comprehensive checks](comprehensive-checks-v1.md)
- [Backup/restore](backup-restore-v1.md)
- [Technology stack](technology-stack.md)
- [Development standards](development-standards.md)

Історичні детальні контракти telemetry, commands, auth, RBAC, events, alarms і
notifications збережені у цій папці та індексуються GitHub.
