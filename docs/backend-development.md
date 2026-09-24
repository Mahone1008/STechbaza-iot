# Backend TechBaza — локальна розробка

Backend TechBaza працює на FastAPI.

## Поточний мінімальний endpoint

```text
GET /health
```

Очікувана відповідь:

```json
{
  "status": "ok",
  "service": "techbaza-backend",
  "version": "0.1.0"
}
```

## Локальна адреса

```text
http://127.0.0.1:8000
```

Перевірка health endpoint:

```text
http://127.0.0.1:8000/health
```

Автоматична документація FastAPI:

```text
http://127.0.0.1:8000/docs
```

## Запуск

У корені репозиторію:

```powershell
docker compose up -d --build
```

Перевірка контейнерів:

```powershell
docker compose ps
```

## Поточна роль backend

На цьому кроці backend лише доводить, що окремий API-сервіс TechBaza запускається у Docker та доступний локально.

Наступні кроки:

1. підключення до PostgreSQL;
2. підключення до MQTT;
3. структура API;
4. користувачі, ролі та об'єкти;
5. телеметрія та команди пристроїв.
