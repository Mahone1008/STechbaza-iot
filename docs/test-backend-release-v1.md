# Тестова збірка backend v1 — межі приймання

## Кандидат після коригувального Етапу H

Backend **0.38.0**, migration **20260926_0017**, **158 tests**.
H-01/H-02/H-03 прийняті користувачем. H-04/H-05 виконуються спільно за його
вказівкою: [досьє та поточні результати](stage-h-backend-corrections.md).
Статус кандидата: **очікує CI та локального приймання; Етап H ще не закрито**.

Додано спільний [module/channel контракт](module-channel-contract-v1.md),
типізовані state readings та 422 замість OverflowError для надмірного
числа в команді частоти. Повний gate включає 158 tests без skips,
Chromium, live HTTP/MQTT, restart/outage, clean install та exact backup/restore.

Локальна спільна перевірка:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-final.ps1
```

Використовується існуючий `.env.demo`. Скрипт не повторює seed у наявному
demo або його restored copy. Тимчасовий чистий стенд отримує власні fixtures.
Перед promotion запускається read-only H-03 preflight існуючої БД.
Зберігаються demo volumes, credentials, користувачі та стан simulator;
тимчасові тестові volumes видаляються. Приватний backup/report залишається
в ігнорованому Git каталозі `backups/acceptance-*`.

## Історично прийнята база Етапу 8

Прийнята тестова збірка: **0.37.0**, migration **20260926_0017**.
**Етап 8 завершено 26.09.2026: усі 6 операцій прийняті користувачем.**
[Повний CI 36269123220](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36269123220)
пройдено: 109 tests без skips, Chromium, чисте встановлення та live restore.
Локальне приймання commit **ae0aada** підтверджене 11 скриншотами:
**109 tests in 7.454s — OK, zero skips**, відновлено всі 20 таблиць і SQLite,
старі tokens/команди не відновили доступ/доставку, health **0.37.0**.
Детальна доказова історія — у [журналі Етапу 8](stage-8-test-backend.md).

## Що підготовлено для фронтенду

| Область | Що отримує перша тестова версія |
|---|---|
| Ізоляція клієнтів | Organizations/sites/devices, memberships, tenant RBAC, актуальна перевірка дозволів |
| Модульність | Capabilities конкретного пристрою, дозволені metrics і commands, відсутні/вимкнені модулі |
| Вхід | Browser login, HttpOnly refresh cookie, rotation/logout, CSRF/CORS, rate limiting, відкликання sessions |
| Перші екрани | Списки, organization access, device overview, availability, telemetry snapshot і freshness |
| Графіки | Обмежені часові вікна, buckets, min/max/average/count, null gaps та явна якість значень |
| Керування | Durable commands, actor audit, request_id idempotency, TTL, retry, ACK/Result, невідомий результат |
| Аварії | Lifecycle, журнал переходів, acknowledge, in-app notifications та персональне прочитання |
| Demo | Два tenants, різні ролі, шість пристроїв з різними capabilities, живий MQTT simulator |
| Перевірки | Unit/integration/HTTP/JWT/Chromium, справжні restart/outage/reconnect, clean install/backup/restore |

Основні документи для Етапу 9:

- [Контракт API перших екранів](frontend-api-contract-v1.md).
- [Browser authentication](browser-auth-v1.md).
- [Показання й графіки](telemetry-panel-charts-v1.md).
- [Demo-стенд](demo-stand-v1.md).
- [Комплексні перевірки](comprehensive-checks-v1.md).
- [Backup/restore](backup-restore-v1.md).

Demo API: `http://127.0.0.1:8001`; OpenAPI: `/openapi.json`; Swagger: `/docs`.
Окремий старий local stack на 8000 не є demo-оточенням для перших екранів.

## Як переходити до Етапу 9

Операцію 6 та Етап 8 закрито після CI й локального приймання. Після
додаткового аудиту перед frontend погоджено Етап H. Його останній gate —
спільне приймання H-04/H-05 за скриптом вище. Після PASS і підтвердження
користувача можна починати Етап 9. Перехід зберігає поетапну роботу з
локальною перевіркою кожної операції; frontend реалізація ще не розпочата.

Перший frontend має пройти шлях: browser session → організація/об'єкт →
список пристроїв → панель конкретного пристрою → графік → команда і стан
її виконання → аварії/notifications. Екрани будуються за capabilities і
permissions API. Успішний HTTP POST не прирівнюється до виконаної команди;
online не прирівнюється до свіжих показань.

## Що лишається до комерційної експлуатації

Ці роботи не блокують створення frontend на ізольованому demo, але
потребують окремих етапів до production:

1. Реальна firmware/Modbus/VFD інтеграція, фізичні interlocks, аварійний
   Stop, durable deduplication та випробування живлення/мережі на обладнанні.
2. Device provisioning, індивідуальні MQTT identities, ACL/TLS,
   ротація/відкликання ключів; публічна інфраструктура з HTTPS і secure cookies.
3. Управління користувачами життєвого циклу: запрошення, відновлення доступу,
   процедури адміністратора й аудит відповідно до погодженого продукту.
4. Експлуатаційні backups: schedule, retention, encryption, off-site restore
   drills, production RPO/RTO, monitoring/alerts та інструкції реагування.
5. Навантаження й обсяги telemetry, retention/aggregation, profiling,
   план масштабування та координовані background workers.
6. Dependency/image pinning, vulnerability scanning/SBOM, секрети CI/deploy,
   контрольований release/rollback і review production-конфігурації.
7. Розширені продуктові функції за потребами клієнтів: зовнішні notifications,
   звіти, додаткові модулі, автоматизації та відповідні permission rules.

Приймання означає перевірені сценарії конкретної тестової збірки.
Воно не означає «помилок немає», завершення всіх майбутніх функцій або
дозвіл підключити керування фізичними насосами без наступних перевірок.
