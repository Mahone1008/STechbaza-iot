# System Alarms v1 — Етап 7, операція 5

## Призначення

Backend створює Event і Alarm для втрати зв'язку, перезапуску контролера
та невиконаної команди. Усі записи прив'язані до Device, тому існуючі
tenant-scoped Events/Alarms API показують їх лише своїй організації.

## Device offline

Фоновий цикл раз на 5 секунд шукає пристрої, що раніше виходили на зв'язок,
але не надсилали heartbeat або telemetry понад
`DEVICE_ONLINE_TIMEOUT_SECONDS` (типово 90 секунд). Для пристрою, який
ще жодного разу не підключався, Alarm не створюється.

Перша перевірка після timeout створює `device.offline` Event і active Alarm.
Наступні цикли не створюють повторів. Перший актуальний heartbeat або
telemetry створює `device.online` Event і переводить Alarm у resolved.
Перевірка, подія та перехід робляться під одним Device lock у межах
однієї транзакції.

## Device reboot

Нова `session_id` у heartbeat чи прийнятій telemetry після вже відомої
session означає перезапуск. Перша session встановлює базовий стан без
тривоги. При новій session з'являються `device.reboot` Event та Alarm;
наступне окреме повідомлення цієї session створює
`device.reboot.stable` Event і закриває Alarm.

`device_sessions` зберігає відомі session. Старі session не викликають
повторний reboot; повтор `message_id` і непослідовний heartbeat
`sequence` також не підтверджують стабільну роботу. Міграція
`20260925_0013` переносить попередні telemetry sessions у журнал
і поточну session зі snapshot пристрою.

Для legacy heartbeat без `session_id` можна підтвердити online, але
визначити reboot неможливо.

## Command failure

Результат `failed` або завершення TTL зі статусом `expired` створюють
`command.failed` Event та Alarm з ключем
`command.failed.{command_type}`. Дублі фінального Result не змінюють
Alarm. Наступна успішна **новіша** команда того самого типу створює
`command.recovered` Event і закриває Alarm. Запізніла помилка старішої
команди не відкриває закриту проблему повторно.

Command, Event і Alarm змінюються однією транзакцією: якщо запис
системної тривоги не вдався, статус команди також відкочується.

## Перевірка в локальному Docker

Після `docker compose up -d --build`:

```powershell
docker compose exec -T backend alembic upgrade head
docker compose exec -T backend alembic current
docker compose exec -T backend python -m app.tools.system_alarm_check
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/system/alarms/status | ConvertTo-Json -Depth 5
```

Перевірочна команда створює тимчасовий Device в ізольованій зовнішній
транзакції, проганяє втрату та відновлення зв'язку, reboot, стару
session, невдалий/дубльований/успішний Result і TTL expiry. Після
перевірки зовнішня транзакція відкочується: тестовий Device,
команди, події та Alarm не залишаються в базі.

## Межі

Фоновий цикл запускається одним backend process у поточній локальній
конфігурації Compose. При горизонтальному масштабуванні потрібен
окремий worker або координоване виконання. Acknowledge, доставки
сповіщень і UI входять до наступних операцій; hardware tests окремі.
