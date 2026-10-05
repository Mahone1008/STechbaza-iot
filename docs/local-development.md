# Локальне середовище розробки

Для сайту з готовими тестовими обліковими записами використовуйте
[frontend README](../frontend/README.md) і [demo](demo-stand-v1.md).
Нижче — окремий dev stack з `compose.yml`, без demo seed.

## Перший запуск dev stack

Потрібні Git та Docker Desktop у Linux containers mode. З кореня репозиторію
створіть `.env` із `.env.example`, якщо його ще немає. Наявні credentials
та volumes зберігайте разом; зміна пароля в `.env` не змінює пароль існуючої БД.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --wait postgres mosquitto
docker compose build backend
docker compose run --rm -T backend alembic upgrade head
docker compose up -d backend
docker compose ps
Invoke-RestMethod http://127.0.0.1:8000/health
```

Compose містить **три** сервіси: PostgreSQL, Mosquitto й backend.
Створення таблиць виконує Alembic, а не HTTP startup. Порожній dev stack
не створює автоматично demo users; для роботи користувача із сайтом призначено demo.

## Оновлення

Перед зміною схеми потрібна узгоджена резервна копія. Для установки до
аудиту 05.10 спочатку перенесіть старий JWT secret у `ACCOUNT_KEY_SECRET`
за [інструкцією ключів](account-key-operations-v1.md). Після отримання коду
зупиніть backend, зберіть image, виконайте міграції та запустіть його знову:

```powershell
git pull --ff-only origin main
docker compose stop backend
docker compose build backend
docker compose run --rm -T backend alembic upgrade head
docker compose up -d backend
```

Перехід до command v2 має додаткові правила [міграції](command-safety-v2.md).
Ці команди не оновлюють окремий demo stack.

## Адреси та зупинка

| Сервіс | Dev | Demo |
|---|---|---|
| API | `127.0.0.1:8000` | `127.0.0.1:8001` |
| PostgreSQL host port | `127.0.0.1:5433` | Немає |
| MQTT host port | `127.0.0.1:1883` | Немає; V3 має окремий TLS gateway |
| Frontend | Окремий Next.js процес на `127.0.0.1:3000`; API задає `.env.local` | Те саме |

`docker compose stop` зупиняє dev stack; `docker compose down` також видаляє
його контейнери/мережу, але зберігає named volumes. `down --volumes` видаляє дані.
[Діагностика backend](backend-development.md), [інфраструктура](../infrastructure/README.md).
