# Notifications foundation v1 — Етап 7, операція 7

**Backend:** 0.31.0  
**Міграція:** `20260925_0015`  
**Статус:** код підготовлено; інтеграційний CI та локальна перевірка користувачем очікуються.

## 1. Що отримує платформа

Стрічку in-app повідомлень організації та персональну позначку прочитання.
Дані доступні через API для майбутнього інтерфейсу. Доступ до історії мають
поточні активні учасники організації з `notification.read`, включно з новими
учасниками. Це спільна історія організації, а не розсилка за списком адресатів.

| Перехід Alarm | Повідомлення |
|---|---|
| Новий incident (`raised`) | Так |
| Зміна важливості (`severity_changed`) | Так, зі snapshot нової severity |
| Проблему усунено (`resolved`) | Так |
| Повтор тієї самої проблеми (`repeated`) | Ні |
| Оператор підтвердив аварію (`acknowledged`) | Ні, дія залишається в actor audit |
| Повторний пакет / повтор того самого transition | Нового повідомлення немає |
| Нова аварія після завершення попередньої | Так, новий incident |

Debounce та hysteresis rule engine застосовуються до створення Alarm.
Notification layer не додає окремих порогів чи датчиків: він працює з
існуючими lifecycle transitions будь-якого дозволеного модуля.

## 2. Транзакційність і збереження історії

Telemetry → Event → Alarm → AlarmTransition → AlarmNotification записуються
однією транзакцією PostgreSQL. Те саме підключення використовується системними
аваріями offline/reboot/command failure/result timeout. NotificationService
не виконує мережевих викликів і не робить окремий commit у lifecycle path.
Якщо запис повідомлення не вдався, зовнішня операція також відкочується.

`UNIQUE(transition_id)` захищає від повторного додавання повідомлення.
Старе повідомлення не переписується при зміні Alarm: title, description,
severity та occurred_at збережено snapshot-ом. Для `resolved` severity
показує важливість інциденту; факт завершення визначається `kind=resolved`.

Повторне читання active Alarm під `FOR UPDATE` оновлює ORM identity map.
Це необхідно, щоб конкурентна зміна severity не зникала з історії повідомлень.

Індекси підтримують вибірку за організацією/часом/ID та видалення залежних
записів за Device/Alarm. Сортування API — `created_at DESC, id DESC`;
`occurred_at` зберігає час події. Offset-пагінація призначена для списку;
при появі нових повідомлень між сторінками клієнт має прибирати дублікати за ID.

## 3. Прочитання, acknowledge і resolve

- `notification_reads`: первинний ключ `(notification_id, user_id)`.
- POST read отримує user_id тільки з перевіреного JWT context.
- Повторний чи одночасний POST не змінює час першого прочитання.
- Прочитання одним користувачем не впливає на іншого.
- GET не позначає повідомлення прочитаним автоматично.
- Read не підтверджує Alarm і не змінює його state.
- Acknowledge — окрема дія з окремими правами та actor audit.
- Resolve виконує lifecycle engine при зникненні причини аварії.

## 4. Доступ

`notification.read` мають owner/admin/operator/viewer/service. Platform
superadmin використовує існуючий bypass; service_admin потребує явного
membership. Перевірка активного користувача та auth session спільна з іншими API.

Усі списки та unread count потребують доступу до конкретної організації.
Чужий ID і відсутній ID повертають однаковий 404; без JWT — 401.
Відкликаний membership закриває доступ на наступному запиті.

Збережена organization_id і поточна організація Device мають збігатися.
Якщо Device перенесли, його старі notification snapshots не відкриваються
новому клієнту й виключаються з поточної стрічки старого клієнта.
Окремий продуктовий процес перенесення історії в цю операцію не входить.

## 5. API

Усі маршрути мають префікс `/api/v1` та потребують Bearer JWT.

| Метод | Шлях | Результат |
|---|---|---|
| GET | `/organizations/{organization_id}/notifications` | Список snapshot з персональним `read_at` |
| GET | `/organizations/{organization_id}/notifications/unread-count` | `{"unread_count": N}` |
| GET | `/notifications/{notification_id}` | Один snapshot з персональним `read_at` |
| POST | `/notifications/{notification_id}/read` | `notification_id`, незмінний перший `read_at` |

Параметри списку: `limit` 1–200 (типово 50), `offset` ≥0,
`unread_only` boolean (типово false). Невалідні параметри — 422.
Публічного API довільного створення, редагування чи розсилки повідомлень немає.

## 6. Міграція та межі реалізації

0015 додає `alarm_notifications` і `notification_reads`. Попередні таблиці
не перебудовуються. Історичні transitions автоматично не перетворюються на
нові повідомлення: стрічка наповнюється новими значущими переходами після
оновлення. Старі аварії залишаються доступні через Alarms API.

Downgrade 0015 → 0014 видаляє ці дві таблиці та їхню історію. Зворотний
перехід перевіряється тільки в тимчасовій порожній CI-базі.

Ця версія реалізує durable in-app стрічку. Telegram/email/SMS/push,
адресати, opt-in, налаштування каналів, доставка з retry/backoff та статуси
провайдерів залишаються наступними окремими блоками. Запис у стрічці не
означає доставку через зовнішній канал. Жодних повідомлень людям CI не надсилає.
UI, навантажувальні тести, retention та фізичний ESP32/VFD також перевіряються окремо.

## 7. Автоматичні перевірки

Новий набір `tests/test_notifications_postgres.py` має вісім сценаріїв:

1. Snapshot raised/severity_changed/resolved, без спаму від repeat, stale
   severity і дубльованого Event/transition; новий incident після resolve.
2. Штучна помилка після INSERT notification відкочує telemetry, snapshot,
   rule state, Event, Alarm та notification; повтор пакета успішний.
3. Справжні JWT/ASGI: tenant 404, unauthenticated 401, pagination 422,
   персональне read/unread count, viewer read без acknowledge, відкликані права/session.
4. Перенесення Device між організаціями не відкриває попередні snapshots.
5. Два одночасні прочитання залишають один receipt і перший timestamp.
6. Два одночасні raises створюють один active incident та одне повідомлення.
7. Стара ORM-копія Alarm не приховує конкурентну зміну severity.
8. Mosquitto QoS 1 → telemetry → debounce → Event/Alarm/notification →
   HTTP read/acknowledge з audit → hysteresis/recovery → resolved notification.

Тести створюють власні організації, Device, користувачів і sessions з
випадковими UUID, видаляють свої записи при звичайному завершенні та перевіряють
очищення notifications/read receipts. Існуючий capability `pressure.read`
використовується без зміни його конфігурації; за відсутності створюється
тимчасовий запис каталогу. Примусове завершення процесу може залишити тестові записи.

Очікування повного набору: `Ran 28 tests — OK` без пропусків.
Без opt-in PostgreSQL/MQTT: 15 виконано, 13 пропущено.

## 8. Локальне оновлення одним блоком PowerShell

Виконувати з кореня локального репозиторію. Блок зупиняється при помилці.
На час тестів backend зупинено, щоб його workers та загальна MQTT-підписка
не обробляли тестові Device паралельно з перевіркою.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    function Assert-Step([string]$Step) {
        if ($LASTEXITCODE -ne 0) { throw "Помилка: $Step (код $LASTEXITCODE)" }
    }

    $projectBranch = git branch --show-current
    Assert-Step 'Перевірка гілки'
    if ($projectBranch -ne 'main') { throw 'Очікується гілка main' }
    $projectChanges = git status --porcelain
    Assert-Step 'Перевірка локальних змін'
    if ($projectChanges) { throw 'Є локальні зміни; спочатку потрібно їх перевірити' }

    git pull --ff-only
    Assert-Step 'Оновлення коду'
    docker compose stop backend
    Assert-Step 'Зупинка backend'
    docker compose build backend
    Assert-Step 'Збірка backend'
    docker compose run --rm -T backend alembic upgrade head
    Assert-Step 'Міграція бази'
    docker compose run --rm -T backend alembic current
    Assert-Step 'Перевірка міграції'
    docker compose run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -v
    Assert-Step 'Повний набір тестів'
    docker compose run --rm -T backend python -m app.tools.alarm_ack_http_check
    Assert-Step 'Регресія HTTP acknowledge'
    docker compose up -d backend
    Assert-Step 'Запуск backend'

    $projectHealth = $null
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            $projectHealth = Invoke-RestMethod http://127.0.0.1:8000/health -TimeoutSec 3
            break
        } catch {
            if ($attempt -eq 14) { throw }
            Start-Sleep -Seconds 1
        }
    }
    $projectHealth | Format-Table
    if ($projectHealth.status -ne 'ok' -or $projectHealth.version -ne '0.31.0') {
        throw 'Неочікувана версія або стан backend'
    }
    Write-Host 'PASS: оновлення, тести та запуск 0.31.0 завершені' -ForegroundColor Green
}
```

Очікується migration `20260925_0015 (head)`, 28 tests `OK`, три `PASS`
HTTP acknowledge та фінальний `PASS` запуску 0.31.0. При помилці потрібно
надіслати вивід; при успіху достатньо підтвердити «є» / «есть».
До цього підтвердження операція 7 залишається відкритою.
