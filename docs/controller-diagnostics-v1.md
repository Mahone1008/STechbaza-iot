# Діагностика контролера v1

Реалізація 01.10.2026: backend **0.40.0**, migration **0019**, V3 firmware **0.2.2**.
Розширено телеметрію та панель пристрою. Зовнішні повідомлення не додано.
Нову прошивку ще потрібно перевірити на фізичному V3; приймання 30.09 стосується
попередньої версії, а не автоматично цього оновлення.

## Дані й межі

| Поле | Значення |
|---|---|
| `version` | Версія блоку діагностики, зараз 1 |
| `firmware_version` | Версія firmware, яка сформувала зразок |
| `uptime_ms` | Час від запуску контролера на момент зразка; 64-бітний monotonic clock |
| `reset_reason` | Причина поточного запуску за даними платформи ESP32; `unknown`, якщо не визначена |
| `connection.transport` | `wifi`, `cellular`, `ethernet` або `unknown` |
| `connection.signal` | Реальний показник `rssi`/`rsrp` у dBm або null; для Wi-Fi дозволено лише RSSI |
| `last_stop` | Останній запит контролера на STOP у поточному запуску або null |

`last_stop` містить `reason`, `uptime_ms`, `requested_at` та `confirmed`.
Подія створюється при запиті STOP, а не при кожному повторі. Початкова причина
й час зберігаються до наступного окремого запиту STOP. Пізніший збій RS485
не переписує початкову причину, наприклад `network_lost`. Новий RUN зберігає
цей запис як історичний; поточний RUN читається окремо. DISARM уже зупиненого
контролера не вигадує нову подію фізичної зупинки.

`confirmed=true` означає читання STOP і 0 Гц із частотника наявним механізмом
перевірки. Це не незалежне вимірювання обертання вала. Поки підтвердження
немає, сайт показує «Зупинку ще не підтверджено».

Причини: `command`, `local_disarm`, `bench_timer`, `network_lost`,
`vfd_link_lost`, `vfd_fault`, `configuration_mismatch`, `storage_failed`,
`physical_result_unconfirmed`, `restart_recovery`.
`network_lost` — втрата готовності мережевого каналу, не доказ саме обриву
Wi-Fi: готовність включає MQTT і синхронізацію часу.

UTC фіксується в момент запиту. Якщо тоді годинник не був синхронізований,
`requested_at=null`; пізніша синхронізація не вигадує минулий час. Monotonic
uptime лишається доступним. UTC може коригуватися NTP, тому порядок подій
не визначається лише порівнянням настінного часу.

`last_stop` живе в RAM поточного запуску; отримана телеметрія лишається в
історії сервера. Після reboot попередня причина не видається за нову.
Якщо збережено незавершений RUN intent, формується `restart_recovery`.
Структура NVS journal, ARM, TTL, порядок STOP і захисти не змінюються.

## V3, V4 і V5

Загальна модель не залежить від Wi-Fi. Адаптер V3 формує `transport=wifi`
та виміряний RSSI. Немає підміни відсутнього сигналу нулем чи відсотком якості.
SSID, IP, паролі, SIM та IMEI до діагностики не включаються.

`cellular` і RSRP підтримані контрактом та інтерфейсом для майбутнього адаптера.
Це **не реалізація і не фізичне приймання 4G**. Після отримання модема V4
окремо реалізуємо вимірювання та відновлення зв'язку. V5 зможе
використати той самий контракт без заміни панелі пристрою.

## MQTT, зберігання й сумісність

До telemetry envelope v1 додано необов'язковий `diagnostics`. З ним
обов'язковий `session_id`: uptime/reset не змішуються між запусками.
Приклад блоку:

```json
{
  "version": 1,
  "firmware_version": "0.2.2",
  "uptime_ms": 125000,
  "reset_reason": "power_on",
  "connection": {"transport": "wifi", "signal": {"metric": "rssi", "dbm": -67}},
  "last_stop": {
    "reason": "command", "uptime_ms": 120000,
    "requested_at": "2026-10-01T08:00:00Z", "confirmed": true
  }
}
```

Діагностика — властивість базового контролера, не додатковий фізичний модуль.
Типізований блок зберігається в nullable JSONB `telemetry_messages.diagnostics`
і `device_states.diagnostics`. Telemetry/state/overview використовують наявні
tenant guards та `telemetry.read`. Нових прав керування немає; capability
policy для `values/state` збережена.

Дублікати, sequence та захист старих session спільні з телеметрією.
Відсутній блок нового зразка очищає діагностику snapshot. Heartbeat не робить
її свіжою. Старі дані та дані попереднього запуску мають явні позначки;
uptime на екрані не продовжується за відсутності нового зразка.

Старі прошивки підтримуються: «Розширена діагностика ще не надходила».
Порядок оновлення: **backend/БД → сайт → firmware**. Старий backend
відхиляє невідоме поле envelope.

## Оновлення налаштованого V3 на Windows

Завершити моторний тест і переконатися у STOP. Зупинити Next.js через Ctrl+C.
Зберегти `.env.demo`, `.env.v3`, сертифікати й `config.local.h`.
Перед оновленням важливого стенда зробити [копію БД](backup-restore-v1.md).
У терміналі VS Code з кореня наявного репозиторію:

```powershell
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося оновити код' }
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml stop backend simulator
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося зупинити сервіси' }
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml build backend
if ($LASTEXITCODE -ne 0) { throw 'Помилка збірки' }
docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml run --rm -T backend alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Помилка міграції' }
docker compose -p techbaza-demo --env-file .env.demo --env-file .env.v3 -f compose.demo.yml -f compose.v3.yml up -d
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося запустити V3' }
Invoke-RestMethod http://127.0.0.1:8001/health
cd frontend
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Помилка встановлення залежностей frontend' }
npm.cmd run dev
```

Очікувані `/health` 0.40.0 та head `20261001_0019`. Migration додає nullable
поля, історія не видаляється. Для цього оновлення не потрібен `prepare-v3.ps1`:
він повторно налаштовує read-only enrollment. Не використовувати `down -v`.

Потім відкрити весь скетч `firmware/kerumo_v3` в Arduino IDE, залишивши
власний `config.local.h` і попередні налаштування плати/бібліотек.
Завантажити через USB. Serial Monitor 115200 має показати **0.2.2**.
ARM після перезапуску не відновлюється автоматично.

## Перевірка

Автотести охоплюють типи, старі пакети, MQTT/TLS → PostgreSQL → overview,
tenant isolation, sequence/session, nullable дані, STOP retry/confirmation,
новий RUN, reboot, відсутній UTC, 64-бітний uptime і різні транспорти у UI.
Для фізичного V3 використовуються тільки вимірювання Wi-Fi.

Ручне приймання після прошивання:

1. Звірити версію, uptime, причину запуску та RSSI.
2. Під час уже дозволеного стендового тесту виконати штатний STOP; звірити
   причину й читання STOP/0 Гц із Serial та панеллю частотника.
3. Новий RUN зберігає попередній STOP як історію; поточний RUN показаний окремо.
4. На зупиненому стенді перевірити старіння діагностики без зв'язку та
   позначення попередньої session після reboot до надходження нового зразка.

Розширення допомагає дослідити V3-01, але не закриває невідтворену причину
Offline після довгої відсутності. Hardware acceptance лишається окремим.
