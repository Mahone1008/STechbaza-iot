# Досьє V3.5 — Етап 2
## Backend Core TechBaza: FastAPI, API та підключення до PostgreSQL

**Статус:** етап у процесі  
**Версія:** V3.5  
**Етап:** 2  
**Поточний результат:** FastAPI backend запущений, API працює, зв'язок із PostgreSQL підтверджений. MQTT-інтеграція підготовлена в коді, але ще не пройшла фінальну перевірку на локальному стенді.

---

# 1. Мета етапу

Мета V3.5 Етапу 2 — створити перший реальний backend TechBaza.

Backend — це центральний серверний рівень системи. Він має знаходитися між frontend, базою даних та польовими контролерами.

Цільова схема:

```text
Frontend
   ↓
FastAPI Backend
   ↙          ↘
PostgreSQL    MQTT
                ↓
              ESP32
                ↓
           RS485 / Modbus
                ↓
               VFD
```

На цьому етапі ми почали реалізовувати саме центральний блок:

```text
FastAPI Backend
```

---

# 2. Навіщо TechBaza потрібен backend

Frontend не повинен напряму працювати:

- з PostgreSQL;
- з MQTT;
- з ESP32;
- з частотним перетворювачем.

Усі запити мають проходити через backend.

Наприклад, у майбутньому команда запуску насоса повинна йти так:

```text
Користувач
   ↓
Frontend
   ↓
FastAPI Backend
   ↓
перевірка прав користувача
   ↓
формування команди
   ↓
MQTT
   ↓
ESP32
   ↓
Modbus RTU
   ↓
VFD
   ↓
Насос
```

Backend також буде відповідати за:

- авторизацію;
- ролі користувачів;
- доступ до конкретних об'єктів;
- команди керування;
- телеметрію;
- аварії;
- журнал подій;
- взаємодію з PostgreSQL;
- взаємодію з MQTT;
- API для frontend.

---

# 3. Створений backend

У репозиторії створено структуру:

```text
backend/
│
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── db.py
│   └── mqtt_client.py      ← MQTT-інтеграція підготовлена
│
├── Dockerfile
├── requirements.txt
├── .dockerignore
└── README.md
```

Поточний backend написаний на:

```text
Python
+
FastAPI
```

Backend запускається окремим Docker-контейнером:

```text
techbaza-backend
```

---

# 4. Перша операція — запуск FastAPI backend

Першим кроком було створено мінімальний FastAPI-сервіс.

Додано endpoint:

```text
GET /health
```

Його задача — перевірити, що backend:

- запущений;
- доступний по HTTP;
- відповідає на API-запит.

Локальна адреса:

```text
http://127.0.0.1:8000/health
```

Фактично отримана відповідь:

```json
{
  "status": "ok",
  "service": "techbaza-backend",
  "version": "0.1.0"
}
```

Це підтвердило:

```text
Браузер
   ↓ HTTP
FastAPI Backend
   ↓
JSON-відповідь
```

---

# 5. Swagger / OpenAPI

FastAPI автоматично створює документацію API.

Вона доступна за адресою:

```text
http://127.0.0.1:8000/docs
```

На першому кроці там був один endpoint:

```text
GET /health
```

Після підключення PostgreSQL з'явився другий:

```text
GET /health/db
```

Swagger потрібен для:

- перегляду всіх API;
- тестування endpoint-ів;
- перегляду параметрів;
- перегляду форматів відповідей;
- подальшого тестування API без frontend.

Схема:

```text
FastAPI code
    ↓
OpenAPI schema
    ↓
Swagger UI
    ↓
http://127.0.0.1:8000/docs
```

---

# 6. Docker-контейнер backend

Backend додано до `compose.yml`.

Тепер Docker Compose запускає вже три сервіси:

```text
Docker Compose
│
├── techbaza-postgres
├── techbaza-mosquitto
└── techbaza-backend
```

Після запуску було підтверджено:

```text
techbaza-backend     Up
techbaza-mosquitto   Up
techbaza-postgres    Up (healthy)
```

Локальний порт backend:

```text
127.0.0.1:8000
```

Схема:

```text
Windows
127.0.0.1:8000
      │
      ▼
Docker
techbaza-backend:8000
```

---

# 7. Dockerfile backend

Для backend створено власний:

```text
backend/Dockerfile
```

Його роль:

1. взяти Python-образ;
2. створити робочу директорію;
3. встановити Python-залежності;
4. скопіювати код backend;
5. запустити Uvicorn;
6. відкрити порт 8000.

Спрощено:

```text
Python image
    ↓
requirements.txt
    ↓
pip install
    ↓
backend code
    ↓
Uvicorn
    ↓
FastAPI
```

---

# 8. Python-залежності

На поточному етапі використовуються:

```text
FastAPI
Uvicorn
SQLAlchemy
psycopg
paho-mqtt
```

Їх ролі:

- **FastAPI** — API-фреймворк;
- **Uvicorn** — сервер, який запускає FastAPI;
- **SQLAlchemy** — робота backend з базою даних;
- **psycopg** — PostgreSQL-драйвер;
- **paho-mqtt** — MQTT-клієнт backend.

---

# 9. Друга операція — Backend → PostgreSQL

Після перевірки базового API backend було підключено до PostgreSQL.

Створено:

```text
backend/app/db.py
```

Зв'язок:

```text
FastAPI Backend
      │
      │ SQLAlchemy
      │ psycopg
      ▼
PostgreSQL
```

---

# 10. Чому backend використовує postgres:5432, а не 127.0.0.1:5433

Це важливий момент.

Для Windows PostgreSQL доступний так:

```text
Windows
127.0.0.1:5433
      ↓
Docker PostgreSQL:5432
```

Але backend теж знаходиться всередині Docker.

Тому backend не виходить через Windows.

Він звертається прямо до іншого Docker-сервісу:

```text
techbaza-backend
      │
      │ postgres:5432
      ▼
techbaza-postgres
```

Тут:

```text
postgres
```

— це ім'я Docker Compose сервісу.

Docker сам знаходить потрібний контейнер у внутрішній мережі.

---

# 11. DATABASE_URL

Для backend використовується рядок підключення до PostgreSQL.

Логічно він виглядає так:

```text
postgresql+psycopg://user:password@postgres:5432/database
```

Для локального TechBaza:

```text
backend
   ↓
DATABASE_URL
   ↓
postgres:5432
   ↓
database techbaza
```

Це дозволяє backend знати:

- де знаходиться база;
- який користувач використовується;
- який пароль;
- яку базу відкрити.

---

# 12. Endpoint GET /health/db

Для реальної перевірки зв'язку створено:

```text
GET /health/db
```

Адреса:

```text
http://127.0.0.1:8000/health/db
```

Це не проста статична відповідь.

Backend реально виконує SQL-запит у PostgreSQL:

```text
Browser
   ↓
GET /health/db
   ↓
FastAPI
   ↓
SQLAlchemy
   ↓
psycopg
   ↓
PostgreSQL
   ↓
SQL query
   ↓
PostgreSQL response
   ↓
FastAPI
   ↓
Browser
```

Фактично отримана відповідь:

```json
{
  "status": "ok",
  "postgresql": {
    "database": "techbaza",
    "user": "techbaza",
    "version": "PostgreSQL 16.15 ..."
  }
}
```

Цим підтверджено:

- backend бачить PostgreSQL;
- PostgreSQL приймає запит від backend;
- backend отримує SQL-відповідь;
- backend перетворює її в JSON;
- браузер отримує результат.

---

# 13. Що означає цей результат

До Етапу 2 у нас було:

```text
PostgreSQL
Mosquitto
```

Але між ними та майбутнім сайтом не було центральної серверної логіки.

Тепер уже є:

```text
             FastAPI Backend
                    │
                    ▼
                PostgreSQL
```

Тобто backend перестав бути просто тестовою програмою.

Він уже реально взаємодіє з іншим сервісом системи.

---

# 14. Поточний HTTP/API-рівень

Зараз доступні:

```text
GET /health
GET /health/db
```

Логіка:

```text
/health
   ↓
Чи працює backend?

/health/db
   ↓
Чи може backend реально працювати з PostgreSQL?
```

У майбутньому тут з'являться:

```text
/api/users
/api/organizations
/api/sites
/api/devices
/api/sensors
/api/telemetry
/api/commands
/api/alarms
```

---

# 15. Підготовка Backend → MQTT

На момент створення цього досьє код наступної операції вже підготовлений у репозиторії.

Створено:

```text
backend/app/mqtt_client.py
```

Додана бібліотека:

```text
paho-mqtt
```

Підготовлена схема:

```text
FastAPI Backend
      │
      │ mosquitto:1883
      ▼
Mosquitto MQTT
```

Заплановані endpoint-и:

```text
GET /health/mqtt
GET /mqtt/last
```

Тестовий topic:

```text
techbaza/test/backend
```

Але важливо:

**ця MQTT-частина ще не вважається підтвердженою, доки не буде пересобрано backend і не буде отримано реальне тестове повідомлення.**

Тобто поточний статус:

```text
Backend → PostgreSQL   ✅ перевірено

Backend → MQTT         🟡 код підготовлено,
                        перевірка ще попереду
```

---

# 16. Як виглядає поточна архітектура

Реально підтверджена частина:

```text
Браузер
   │
   │ HTTP
   ▼
FastAPI Backend
   │
   │ SQL
   ▼
PostgreSQL
```

Поряд уже працює:

```text
Mosquitto MQTT
```

Наступна ціль:

```text
                 FastAPI Backend
                  ↙         ↘
                 ↙           ↘
          PostgreSQL       Mosquitto
                              ↑
                              │
                            ESP32
```

---

# 17. Майбутня роль backend у реальному керуванні насосом

У кінцевій системі backend стане центральною точкою прийняття рішень.

Наприклад:

```text
Клієнт натискає START
        ↓
Frontend
        ↓
POST /api/devices/.../commands
        ↓
Backend
        ↓
Перевірка:
- хто користувач?
- чи має він доступ?
- чи цей насос належить його об'єкту?
- чи дозволена команда?
        ↓
MQTT
        ↓
ESP32
        ↓
RS485 / Modbus
        ↓
VFD
        ↓
Насос запускається
```

У зворотному напрямку:

```text
VFD
 ↓
ESP32
 ↓ MQTT
Mosquitto
 ↓
Backend
 ↓
PostgreSQL
 ↓
Frontend
 ↓
Клієнт бачить стан
```

---

# 18. Важливий принцип безпеки

Frontend у production не повинен напряму надсилати MQTT-команди ESP32.

Правильна схема:

```text
Frontend
   ↓
Backend
   ↓
перевірка прав
   ↓
MQTT
   ↓
ESP32
```

Неправильна схема:

```text
Frontend
   ↓
напряму MQTT
   ↓
ESP32
```

Backend потрібен як центральний контрольний шар.

---

# 19. Модульність TechBaza

Backend надалі має працювати за головним правилом системи:

**TechBaza — модульний конструктор.**

Backend не повинен припускати, що кожен пристрій має однакові датчики.

Наприклад:

```text
Device A
├── VFD
├── pressure
└── current

Device B
├── VFD
├── pressure
├── level
└── fertilizer module

Device C
└── VFD
```

У майбутньому backend має запитувати конфігурацію пристрою з PostgreSQL і на її основі визначати доступні можливості.

---

# 20. Що вже завершено в Етапі 2

Підтверджено на реальному локальному середовищі:

```text
FastAPI backend                         ✅
Docker container techbaza-backend       ✅
GET /health                             ✅
Локальний HTTP :8000                    ✅
Swagger /docs                           ✅
SQLAlchemy                              ✅
psycopg                                 ✅
Backend → PostgreSQL                    ✅
GET /health/db                          ✅
database = techbaza                     ✅
user = techbaza                         ✅
PostgreSQL 16.15                        ✅
```

Підготовлено, але ще не підтверджено тестом:

```text
paho-mqtt                               🟡
backend/app/mqtt_client.py              🟡
Backend → Mosquitto                     🟡
GET /health/mqtt                        🟡
GET /mqtt/last                          🟡
```

---

# 21. Що ще не реалізовано

На цьому етапі ще немає:

- реальних таблиць доменної моделі TechBaza;
- Alembic-міграцій;
- користувачів;
- ролей;
- авторизації;
- JWT;
- клієнтів;
- об'єктів;
- пристроїв;
- телеметрії в базі;
- журналу команд;
- аварій;
- команд насосом;
- production MQTT security;
- ESP32 через MQTT;
- frontend → backend;
- production server.

---

# 22. Поточна схема всієї TechBaza

```text
                    ПОТОЧНИЙ СТАН

                 ┌─────────────────┐
Browser ────────▶│ FastAPI Backend │
                 └────────┬────────┘
                          │
                          │ SQLAlchemy / psycopg
                          ▼
                 ┌─────────────────┐
                 │   PostgreSQL    │
                 │    techbaza     │
                 └─────────────────┘

                 ┌─────────────────┐
                 │    Mosquitto    │
                 │      MQTT       │
                 └─────────────────┘
                          ▲
                          │
                   наступне підключення
                          │
                    FastAPI Backend
```

---

# 23. Наступна операція

Наступна операція — завершити та перевірити:

```text
Backend
   ↓
MQTT
   ↓
Mosquitto
```

Потрібно підтвердити:

1. backend підключився до Mosquitto;
2. backend підписався на topic;
3. MQTT-повідомлення реально прийшло в backend;
4. endpoint `/mqtt/last` показав отримане повідомлення.

Після цього буде підтверджена схема:

```text
Publisher
   ↓
Mosquitto
   ↓
FastAPI Backend
   ↓
API
   ↓
Browser
```

---

# 24. Підсумок

V3.5 Етап 2 створив перший справжній серверний мозок TechBaza.

До цього ми мали інфраструктуру:

```text
PostgreSQL + MQTT
```

Тепер маємо:

```text
             FastAPI Backend
                    ↓
                PostgreSQL
```

І вже підготовлений наступний зв'язок:

```text
FastAPI Backend
      ↓
Mosquitto MQTT
```

Головний підтверджений результат етапу на поточний момент:

```text
Browser
  ↓
FastAPI
  ↓
PostgreSQL
  ↓
реальна SQL-відповідь
  ↓
Browser
```

**V3.5 — Етап 2: backend запущено, HTTP API працює, зв'язок із PostgreSQL підтверджено. MQTT-частина підготовлена та очікує перевірки.**
