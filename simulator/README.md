# Симулятор

Постійний симулятор для тестування TechBaza без фізичного обладнання
реалізовано в `backend/app/demo/`. Він використовує той самий Python image,
але працює окремим контейнером з власним SQLite volume і без PostgreSQL.

Стенд має два demo tenants, чотири облікові записи з різними tenant-ролями, шість пристроїв
з різними capabilities, heartbeat, живу телеметрію, ACK/Result команд,
сценарії аварії/відновлення/пропуску та durable command deduplication.

- [Повна інструкція стенда](../docs/demo-stand-v1.md)
- [Окремий Compose](../compose.demo.yml)
- [Поточна PowerShell перевірка операції 5](../scripts/check-stage8-op5.ps1)
- [Комплексні перевірки та recovery](../docs/comprehensive-checks-v1.md)

Основний API залишається на 8000; demo API доступний на 127.0.0.1:8001.
Пристрої мають префікс TB-DEMO-. Це програмна імітація, не firmware ESP32
і не підтвердження поведінки фізичного частотника.
