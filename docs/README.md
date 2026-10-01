# Документація KERUMO

Почніть з [поточного стану](project-status.md) та [аудиту 30.09.2026](audit-2026-09-30.md).
Чинні документи описують реалізацію; плани — майбутні критерії; історичні
досьє — докази своїх дат і revisions. Старий PASS не означає PASS поточного commit.
Назви/посилання збережено, щоб не втрачати історію та зовнішні bookmarks.

Швидкий запуск: [сайт на Windows](../frontend/README.md), [dev](local-development.md),
[V3 читання](v3-su600-bench.md), [V3 з двигуном](v3-su600-extended-test.md).

## Поточна точка та аудит

- [Аудит документації та коду — 30.09.2026](audit-2026-09-30.md)
- [Довідник поточної реалізації](generated-code-reference.md)
- [Поточний стан KERUMO](project-status.md)

## Чинні контракти й інструкції

- [Alarm Lifecycle v1](alarm-lifecycle-v1.md)
- [Alarm Rule Engine v1](alarm-rule-engine-v1.md)
- [HTTP API v1](api-v1.md)
- [Authentication Token Protocol v1](auth-token-v1.md)
- [Backend — локальна розробка та діагностика](backend-development.md)
- [Чисте встановлення та backup/restore v1](backup-restore-v1.md)
- [Авторизація браузера v1 — Етап 8, операція 2](browser-auth-v1.md)
- [Command Actor Audit v1](command-actor-audit-v1.md)
- [Безпечний порядок команд — MQTT v2](command-safety-v2.md)
- [Таймер і програми частоти v1 — оновлення, контракт, приймання](control-programs-v1.md)
- [Календарні розклади v1 — правила часу, оновлення та перевірка](control-schedules-v1.md)
- [Current User / Session Context v1](current-user-context-v1.md)
- [Демонстраційний стенд v1](demo-stand-v1.md)
- [Стандарти розробки TechBaza](development-standards.md)
- [Device Presence v1](device-presence-v1.md)
- [Діагностика контролера v1 — оновлення V3, контракт для V4/V5](controller-diagnostics-v1.md)
- [Events & Alarms Data Model v1](events-alarms-data-model-v1.md)
- [Контракт API перших екранів — Етап 8, операції 1–3](frontend-api-contract-v1.md)
- [Локальне середовище розробки](local-development.md)
- [Membership Management v1](membership-management-v1.md)
- [Модулі та канали першого UI — H-04](module-channel-contract-v1.md)
- [MQTT Command ACK Protocol v1](mqtt-command-ack-v1.md)
- [MQTT Command Result Protocol v1](mqtt-command-result-v1.md)
- [Notifications foundation v1 — Етап 7, операція 7](notifications-foundation-v1.md)
- [RBAC + Multi-tenant Guards v1](rbac-multitenant-guards-v1.md)
- [System Alarms v1 — Етап 7, операція 5](system-alarms-v1.md)
- [Технологічний стек TechBaza / KERUMO](technology-stack.md)
- [Capability-aware Telemetry Policy v1](telemetry-capability-policy-v1.md)
- [Telemetry Contract v1](telemetry-contract-v1.md)
- [Telemetry Ordering v1](telemetry-ordering-v1.md)
- [Показання панелі та графіки v1](telemetry-panel-charts-v1.md)
- [Telemetry Session Protection v1](telemetry-session-protection-v1.md)
- [V3 — перший фізичний стенд SU600 і сайт KERUMO](v3-su600-bench.md)
- [V3 / SU600 — тривалі випробування з двигуном](v3-su600-extended-test.md)

## Плани та критерії приймання

- [Frontend v1 — поетапний план KERUMO](frontend-roadmap-v1.md)
- [KERUMO — план готовності продукту v1](product-readiness-plan-v1.md)

## Попередній command protocol

- [Command Core v1](command-core-v1.md)
- [Command Reliability v1](command-reliability-v1.md)
- [MQTT Command Protocol v1](mqtt-command-protocol-v1.md)

## Історія етапів і докази

- [Повторний огляд backend після Етапу H](backend-review-after-h-2026-09-27.md)
- [Комплексні перевірки v1 — Етап 8, операція 5](comprehensive-checks-v1.md)
- [Модель даних TechBaza v1](database-model-v1.md)
- [Досьє V3 — керування SU600 з двигуном та перевірки зупинки](dossier-v3-su600-control-bench.md)
- [Досьє V3 — читання SU600 на фізичному стенді та відображення на сайті](dossier-v3-su600-read-only-bench.md)
- [Досьє V3.5 — Етап 1  ](dossier-v3.5-stage-1-local-infrastructure.md)
- [Досьє V3.5 — Етап 10](dossier-v3.5-stage-10-browser-auth-session-rbac.md)
- [Досьє V3.5 — Етап 11](dossier-v3.5-stage-11-inventory-modular-dashboard.md)
- [Досьє V3.5 — Етап 12](dossier-v3.5-stage-12-telemetry-commands.md)
- [Досьє V3.5 — Етап 13](dossier-v3.5-stage-13-alarms-notifications.md)
- [Досьє V3.5 — Етап 14](dossier-v3.5-stage-14-frontend-test-baseline.md)
- [Досьє V3.5 — Етап 2](dossier-v3.5-stage-2-backend-core.md)
- [Досьє V3.5 — Етап 3](dossier-v3.5-stage-3-data-model.md)
- [Досьє V3.5 — Етап 4](dossier-v3.5-stage-4-iot-telemetry-reliability.md)
- [Досьє V3.5 — Етап 5](dossier-v3.5-stage-5-remote-command-core.md)
- [Досьє V3.5 — Етап 6](dossier-v3.5-stage-6-users-auth-rbac.md)
- [Досьє V3.5 — Етап 7](dossier-v3.5-stage-7-events-alarms-core.md)
- [Досьє V3.5 — Етап 8](dossier-v3.5-stage-8-test-backend.md)
- [Досьє V3.5 — Етап 9](dossier-v3.5-stage-9-frontend-foundation.md)
- [End-to-End Command Test v1](end-to-end-command-test-v1.md)
- [Виправлення надійності та доступу — 25.09.2026](hardening-2026-09-25.md)
- [Identity & RBAC Foundation v1](identity-rbac-foundation-v1.md)
- [Огляд KERUMO після Етапу 10](project-review-after-stage10-2026-09-28.md)
- [Security End-to-End Test v1](security-e2e-test-v1.md)
- [Етап 10, операція 1 — справжній browser login KERUMO](stage-10-op1-browser-login.md)
- [Етап 10, операція 2 — відновлення browser session KERUMO](stage-10-op2-session-recovery.md)
- [Етап 10, операція 3 — профіль, permissions і route guards KERUMO](stage-10-op3-permissions-and-guards.md)
- [Етап 10, операція 4 — logout, revoke і захист від session resurrection KERUMO](stage-10-op4-logout-and-failures.md)
- [Етап 11.1 — організації, об’єкти та перевірений контекст](stage-11-op1-organizations-sites.md)
- [Етап 11.2 — список пристроїв та обмежені перевірки зв’язку](stage-11-op2-device-list.md)
- [Етап 11.3 — registry віджетів модулів і каналів](stage-11-op3-module-widgets.md)
- [Етап 11.4 — якість даних і зміни конфігурації](stage-11-op4-quality-and-configuration.md)
- [Етап 12 — згортання технічних деталей без порожньої області](stage-12-details-collapse-2026-09-28.md)
- [Етап 12.1–12.2 — збереження фільтрів після F5](stage-12-history-preferences-2026-09-28.md)
- [Етап 12.1 — історія телеметрії](stage-12-op1-telemetry-history.md)
- [Етап 12.2 — єдина політика оновлення](stage-12-op2-polling.md)
- [Етап 12.3 — Start / Stop / frequency](stage-12-op3-command-controls.md)
- [Етап 12.4 — lifecycle і журнал команд](stage-12-op4-command-journal.md)
- [Етап 13.1 — реальні аварії та історія інцидентів](stage-13-op1-alarms.md)
- [Етап 13.2 — підтвердження аварії оператором](stage-13-op2-acknowledgement.md)
- [Етап 13.3 — персональне прочитання повідомлень організації](stage-13-op3-notifications.md)
- [Етап 13.4 — наскрізний інцидент MQTT → browser → recovery](stage-13-op4-incident-e2e.md)
- [Етап 14.1 — UX та доступність основних екранів KERUMO](stage-14-op1-ux-accessibility.md)
- [Етап 14.2 — наскрізні browser regressions KERUMO](stage-14-op2-browser-regression.md)
- [Етап 14.3 — Безпека та продуктивність тестової бази](stage-14-op3-security-performance.md)
- [Етап 14.4 — Тестова база frontend і досьє](stage-14-op4-test-baseline.md)
- [V3.5 — Етап 5](stage-5-remote-command-core.md)
- [Етап 6 — Users, Authentication & RBAC](stage-6-users-auth-rbac.md)
- [Етап 7 — Events & Alarms Core](stage-7-events-alarms-core.md)
- [Етап 8 — Підготовка тестової версії backend](stage-8-test-backend.md)
- [Етап 9, операція 1 — UX-сценарії та макети KERUMO](stage-9-op1-ux-and-mockups.md)
- [Етап 9, операція 2 — каркас і базові компоненти KERUMO](stage-9-op2-frontend-foundation.md)
- [Етап 9, операція 3 — API adapter і контракти KERUMO](stage-9-op3-api-adapter.md)
- [Етап 9, операція 4 — відтворюваний frontend baseline KERUMO](stage-9-op4-frontend-baseline.md)
- [Етап H — коригування backend перед frontend](stage-h-backend-corrections.md)
- [Telemetry ingestion — локальна перевірка](telemetry-ingestion-local-test.md)
- [Тестова збірка backend v1 — межі приймання](test-backend-release-v1.md)
