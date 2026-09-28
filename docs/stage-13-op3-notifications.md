# Етап 13.3 — персональне прочитання повідомлень організації

Дата: 28.09.2026. База: `e7001d7`; разом із [13.4 — MQTT incident E2E](stage-13-op4-incident-e2e.md).
Реалізовано. **Фінальний CI: 83 unit / 133 mocked / 10 live + 44 повтори — PASS**.
OpenAPI zero diff, types/lint/build — PASS. Workflow/head та MQTT-докази — у 13.4.
Windows 28.09.2026: **133 mocked / 10 live / cumulative gate — PASS**.
Стрічку, картку непрочитаного recovery та історію incident показано на скриншотах;
решта ручного приймання відкрита. Детальні докази та їхні межі — у 13.4.

## Реальні API та навігація

«Повідомлення» доступні в desktop і mobile navigation з `notification.read`.
`/notifications` використовує підтверджену поточну організацію; явні маршрути:

- `/organizations/{organizationId}/notifications` — стрічка;
- `/organizations/{organizationId}/notifications/{notificationId}` — snapshot.

UUID і tenant перевіряються до показу даних. Route guard вимагає
`notification.read`, backend повторно перевіряє кожен запит. Login returnTo
підтримує новий розділ. Cache keys містять user/session/organization/notification;
зміна маршруту, користувача чи організації прибирає попередній контекст.

Стрічка виконує два GET: organization notifications і unread-count. Немає
fan-out по пристроях, фонових badge-запитів, polling або вигаданого total.
Лічильник стосується всіх непрочитаних поточного користувача в організації.
Це два окремі backend reads, не атомарний snapshot: під час нових подій
результати можуть відрізнятися, про що є пояснення в UI.

Фільтр — «Усі» / «Непрочитані мною» (`unread_only`). Limit 21, показано 20,
offset page×20. Сторінка замінюється цілком, записи не накопичуються; перевірка
унікальності ID відхиляє дублікати в одній відповіді. Нові події й прочитання
можуть пересунути межі offset-сторінок. Оновлення та зміна фільтра повертають
першу сторінку. Порожній результат показано явно.

## Snapshot і три незалежні дії

Картка містить title/description, kind raised/severity_changed/resolved,
severity, час події/створення та персональний read_at. Час позначено UTC,
оскільки стрічка містить різні об’єкти. Технічні IDs сховані в `<details>`;
довільний текст екранується React. Стан на момент події не видається за
поточний стан аварії. Посилання «До інциденту» доступне з `alarm.read`.

| Дія | Значення |
|---|---|
| Прочитати повідомлення | Персональна відмітка поточного user; доступна також viewer |
| Підтвердити аварію | Окрема дія оператора з `alarm.acknowledge` і actor audit |
| Усунути причину | Перехід alarm engine після recovery; у цьому UI немає ручного resolve |

GET і відкриття картки нічого не позначають прочитаним. Кнопка
«Позначити прочитаним» виконує один явний POST `/notifications/{id}/read`.
Backend ідемпотентний за notification/user та зберігає перший read_at.
Подвійний клік блокується синхронним guard. Перевіряються ID receipt і час;
UI перечитує GET без optimistic read/count. При поверненні у стрічку count
запитується заново. Прочитання іншою людиною не змінює поточного read_at.

## Збої та скасування

Спільна query policy: timeout 10 с, retry=false, manual refresh із Retry-After,
abort hidden/offline/navigation/logout, gcTime=0. Loading/error приховує старі
дані; при збої list або count приховано обидва. Помилка count не стає нулем.
StableRegion утримує геометрію; згортання деталей звільняє місце.

POST не повторюється автоматично, включно з 401. Немає збереженого pending
intent. F5/reconnect не надсилають POST. Network/timeout/5xx/invalid receipt
вимагають успішного GET перед новою явною спробою. 429 додатково зберігає
Retry-After після GET; таймер лише оновлює доступність кнопки. POST 401/403/404
приховує snapshot і перехід до інциденту до перевірки доступу. Скасування
transport не означає гарантованого скасування вже прийнятого сервером read.

## Перевірки та межі

8 нових unit tests: tenant/IDs, enums/time/nullability, bounded pages,
unread filter, count, receipt, routes і cache scopes. 18 нових mocked browser
scenarios: список/count, paging/filter/reset, empty/foreign, permissions,
viewer read/F5/count, double click, uncertain result із записом та без нього,
429, POST 401/403/404, invalid receipt, mobile/escaping, offline/reconnect,
late response після навігації. Live personal reads і MQTT flow — у 13.4.

Backend application code, OpenAPI 0.38.0 / 47 paths та 17 migrations не
змінюються. Push, email/SMS, read-all, background badge і real-time transport
не входять у цю операцію. Windows gate пройдено; ручне приймання часткове.
