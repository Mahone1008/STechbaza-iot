# API v1 TechBaza

Публічний прикладний API версіонується через префікс:

```text
/api/v1
```

Це дозволяє надалі змінювати контракт API без раптового ламання старих клієнтів.

## Перший доменний ресурс: organizations

Доступні endpoint-и:

```text
GET  /api/v1/organizations
GET  /api/v1/organizations/{organization_id}
POST /api/v1/organizations
```

## Архітектурні шари

```text
HTTP request
    ↓
FastAPI router
    ↓
Service
    ↓
Repository
    ↓
SQLAlchemy Session
    ↓
PostgreSQL
```

Router відповідає лише за HTTP-контракт.

Service містить бізнес-правила.

Repository містить SQL/ORM-запити.

Таке розділення потрібне, щоб логіка не накопичувалась у великих endpoint-функціях і могла тестуватися окремо.

## Створення тестової організації

Через Swagger:

```text
POST /api/v1/organizations
```

Приклад body:

```json
{
  "name": "TechBaza Test Farm",
  "slug": "techbaza-test-farm"
}
```

Очікуваний HTTP status:

```text
201 Created
```

Після цього:

```text
GET /api/v1/organizations
```

повинен повернути створений запис.

Повторне створення того самого `slug` має повернути:

```text
409 Conflict
```

Це перевіряє не лише API, а повний ланцюг запису даних у PostgreSQL.


## Другий доменний ресурс: sites

Site — це конкретний фізичний об'єкт організації.

Доступні endpoint-и:

```text
GET  /api/v1/organizations/{organization_id}/sites
POST /api/v1/organizations/{organization_id}/sites
GET  /api/v1/sites/{site_id}
```

Приклад створення Site:

```json
{
  "name": "Поле 1",
  "code": "field-1",
  "timezone": "Europe/Kyiv"
}
```

Архітектурний зв'язок:

```text
Organization
    ↓ 1:N
Site
```

Поле `code` унікальне не глобально, а в межах конкретної організації.

Це означає, що дві різні організації можуть мати, наприклад, власний `field-1`, але одна організація не може створити два Site з однаковим code.
