# Тестова збірка backend v1 — межі приймання

Кандидат: **0.37.0**, migration **20260926_0017**.
Операції 1–5 Етапу 8 прийняті користувачем. Операція 6 реалізована;
повний CI та локальне приймання фіксуються в [журналі Етапу 8](stage-8-test-backend.md).
До локального підтвердження операція 6 і Етап 8 залишаються відкритими.

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

Після успішного локального запуску операції 6 фіксуються commit, 109 tests
без пропусків, migration head, точне відновлення всіх таблиць, відмова
старим tokens/командам, live PASS, health 0.37.0 та фінальний звіт.
Після цього можна закрити операцію 6, Етап 8 і окремо погодити операції
Етапу 9. Фронтенд цією операцією не створюється.

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
