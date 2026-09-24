# Backend TechBaza — локальна розробка

Backend TechBaza працює на FastAPI.

## Поточні endpoint-и

### Перевірка backend

```text
GET /health
```

Очікувана відповідь:

```json
{
  "status": "ok",
  "service": "techbaza-backend",
  "version": "0.2.0"
}
```

### Перевірка зв'язку backend → PostgreSQL

```text
GET /health/db
```

Цей endpoint виконує реальний SQL-запит через SQLAlchemy та psycopg.

Очікувана структура відповіді:

```json
{
  "status": "ok",
  "postgresql": {
    "database": "techbaza",
    "user": "techbaza",
    "version": "PostgreSQL ..."
  }
}
```

## Локальні адреси

```text
Backend:
http://127.0.0.1:8000

Health:
http://127.0.0.1:8000/health

PostgreSQL health:
http://127.0.0.1:8000/health/db

Swagger / OpenAPI:
http://127.0.0.1:8000/docs
```

## Як backend підключається до PostgreSQL

Backend і PostgreSQL знаходяться в одній внутрішній Docker-мережі.

Тому backend звертається не до Windows-порту 5433, а прямо до Docker-сервісу:

```text
backend
  │
  │ postgres:5432
  ▼
PostgreSQL
```

Порт `5433` потрібен лише для доступу до PostgreSQL з Windows.

## Запуск після змін

У корені репозиторію:

```powershell
git pull
docker compose up -d --build
docker compose ps
```

## Поточний стан

Завершено:

1. окремий FastAPI-сервіс;
2. endpoint `GET /health`;
3. реальне підключення backend до PostgreSQL;
4. endpoint `GET /health/db`.

Наступним кроком буде підключення backend до MQTT-брокера.
