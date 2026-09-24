# Backend TechBaza — локальна розробка

Backend TechBaza працює на FastAPI.

## Поточні endpoint-и

### Перевірка backend

```text
GET /health
```

### Перевірка backend → PostgreSQL

```text
GET /health/db
```

Цей endpoint виконує реальний SQL-запит через SQLAlchemy та psycopg.

### Перевірка backend → MQTT

```text
GET /health/mqtt
```

Якщо backend підключений до Mosquitto, endpoint повертає `status: ok`.

### Останнє MQTT-повідомлення

```text
GET /mqtt/last
```

Backend підписаний на тестовий topic:

```text
techbaza/test/backend
```

Після отримання повідомлення endpoint `/mqtt/last` показує останній topic, payload, QoS, retain та час отримання.

## Локальні адреси

```text
Backend:
http://127.0.0.1:8000

Health:
http://127.0.0.1:8000/health

PostgreSQL health:
http://127.0.0.1:8000/health/db

MQTT health:
http://127.0.0.1:8000/health/mqtt

Останнє MQTT-повідомлення:
http://127.0.0.1:8000/mqtt/last

Swagger / OpenAPI:
http://127.0.0.1:8000/docs
```

## Внутрішня Docker-схема

```text
PostgreSQL
    ↑
    │ postgres:5432
    │
FastAPI Backend
    │
    │ mosquitto:1883
    ↓
Mosquitto MQTT
```

## Тест отримання MQTT-повідомлення backend-ом

Після запуску контейнерів відправити:

```powershell
docker exec -it techbaza-mosquitto mosquitto_pub -h localhost -t techbaza/test/backend -m "message for backend"
```

Потім відкрити:

```text
http://127.0.0.1:8000/mqtt/last
```

Очікується, що backend покаже отримане повідомлення.

## Запуск після змін

```powershell
git pull
docker compose up -d --build
docker compose ps
```

## Поточний стан

Завершено:

1. окремий FastAPI-сервіс;
2. `GET /health`;
3. реальне підключення backend до PostgreSQL;
4. `GET /health/db`;
5. MQTT-клієнт всередині backend;
6. `GET /health/mqtt`;
7. підписка backend на тестовий MQTT-topic;
8. `GET /mqtt/last`.

Наступний крок — перевірити реальне MQTT-повідомлення, яке отримує сам backend.
