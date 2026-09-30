# Інфраструктура

| Реалізація | Призначення |
|---|---|
| [compose.yml](../compose.yml) | Локальні PostgreSQL, Mosquitto, backend; API 8000 |
| [compose.demo.yml](../compose.demo.yml) | Ізольований demo із simulator; API 8001 |
| [mosquitto/mosquitto.conf](mosquitto/mosquitto.conf) | Внутрішній broker локальної розробки |
| [v3](v3) | Генерація TLS gateway, device credentials/ACL для V3 |

Внутрішній anonymous broker доступний у Docker-мережі/через loopback dev-порт.
ESP32 підключається до окремого V3 gateway з TLS, паролем та обмеженням topics.
[Підготовка V3](../docs/v3-su600-bench.md) описує точну схему, firewall і секрети.

Це локальні конфігурації. Production HTTPS/reverse proxy, provisioning/rotation,
моніторинг, незалежний backup та масштабування ще потребують реалізації й приймання:
[план продукту](../docs/product-readiness-plan-v1.md).
