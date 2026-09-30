# Етап 11.1 — організації, об’єкти та перевірений контекст

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата: 28.09.2026. Backend **0.38.0**, OpenAPI **47 paths**.

**Прийнято й закрито 28.09.2026 разом із 11.2. CI та Windows:
31 unit / 40 mocked / 10 live — PASS. Користувач підтвердив решту ручних
перевірок повідомленням «Работает». Прийнято 10/24; наступні 11.3/11.4.**

## Поведінка

| Маршрут | Результат |
|---|---|
| `/organizations` | Paginated каталог доступних організацій |
| `/organizations/{organizationId}/sites` | Об’єкти організації |
| `/organizations/{organizationId}/sites/{siteId}/devices` | Пристрої об’єкта |
| `/devices` | Відновлення підтвердженого вибору; спочатку — активна організація й перший доступний об’єкт |
| `/devices/{UUID}` | Перевірена identity та availability пристрою |

Breadcrumbs та зміна організації/об’єкта працюють на desktop і mobile.
Прямі посилання проходять login `returnTo`. Неактивна організація не є
посиланням на workspace. Є loading, empty, error, retry, previous/next.
Помилка API не підміняється fixtures.

Каталоги використовують **20 видимих рядків**, `limit=21`, `offset=page*20`.
Додатковий рядок визначає наступну сторінку. Backend не повертає total:
UI не вигадує кількість записів у всьому каталозі. Позиція сторінки локальна
для маршруту; після F5 список починається з першої сторінки.

## Перевірка контексту

1. `/auth/me` підтверджує користувача та `auth_session_id`.
2. Явний organization ID перевіряється через detail API, права — через
   `/organizations/{id}/access`; site URL також перевіряє точну належність
   об’єкта до організації. Device URL проходить device → site → org → access.
3. При зміні маршруту попередній tenant content приховується до effect,
   запити скасовуються, session query cache видаляється. Пізня відповідь
   не може опублікувати попередній access context.
4. Явний успішний вибір зберігає тільки organization/site IDs у `sessionStorage`
   під ключем `kerumo.context.v1:{user_id}:{auth_session_id}`. Назви, permissions,
   credentials і tokens не зберігаються. F5 повторно перевіряє IDs через API.
5. Недоступний/видалений збережений контекст очищується; є шлях повторного
   вибору організації. Недоступний storage не блокує роботу.
6. Anonymous/logout очищає збережений контекст. Інший user/session не
   використовує попередній ключ. Backend залишається authorization guard.

Початковий автоматичний вибір обмежений першими 100 організаціями. Якщо там
немає активної, gate веде до повного paginated каталогу. Доступ до наступних
сторінок і прямого UUID не залежить від початкової сотні.

GET query має не більше двох автоматичних повторів; 401/403/404/429,
скасування й некоректна відповідь не повторюються. Окремий auth adapter
може одноразово повторити GET після відновлення session на 401.

## Перевірки

Регресії охоплюють org/site pagination, inactive rows, зміну tenant,
F5/restore, видалений збережений site, foreign parent, malformed IDs,
ізоляцію query keys та відсутність fixture fallback. Live Chromium проходить
org → site → device через справжній FastAPI/PostgreSQL і перевіряє відмову
для organization/site/device іншого demo tenant.

[Спільний прогін, результати CI й Windows-команда — 11.2](stage-11-op2-device-list.md).
Backend, міграції, firmware та MQTT contract не змінені.
