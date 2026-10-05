# База даних

PostgreSQL зберігає організації/об'єкти/пристрої, capabilities, користувачів,
ролі та сесії, телеметрію/snapshot, команди, події, аварії й повідомлення.
Поточна схема також містить календарні правила/запуски, паспорти модулів
і revision конфігурацій, account security та factory/claim audit.
Реалізація моделей — [backend/app/models](../backend/app/models),
версійовані зміни — [backend/alembic/versions](../backend/alembic/versions).

[Поточна схема з коду](../docs/generated-code-reference.md).
Історична [початкова модель v1](../docs/database-model-v1.md) описує перший етап,
а не весь нинішній набір таблиць. Міграції, які вже застосовувалися, не переписуються.

[Локальний запуск](../docs/local-development.md),
[backup/restore і карантин команд](../docs/backup-restore-v1.md).
Production retention, PITR, окремі DB roles та виміряні RPO/RTO залишаються
у [плані P0–P9](../docs/product-readiness-plan-v1.md).
