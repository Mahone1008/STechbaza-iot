# V4: SU600 через LTE на наявному сервері Windows

Firmware **0.9.0** додає програмну основу; фізичне приймання PPP/TLS/MQTT
на A7670E залишається відкритим. V4 є стендом; V5 буде окремим виробом.
Наявний сайт і протокол збережено, нові екрани моніторингу не додаються.

Програмно перевірено: збірки ESP32-S3 LTE ReadOnly/Remote і Wi-Fi; native
STOP/TTL/replay/recovery та cellular deadlines; JSON telemetry/ACK/result за
контрактами backend; справжній TLS broker, відмова при неправильних CA/hostname,
паролях і topic ACL; імітована cellular telemetry до API, STOP→ACK→Result та
read-only observer із підтвердженням нового message_id у PostgreSQL.
Ці результати не підтверджують PPP або пуск на фізичному A7670E/SU600.

## Вихідний стан і транспорт

Досьє `KERUMO_V4_Dossier.docx` від 08.10.2026 описує успішні AT, реєстрацію
Kyivstar та HTTP 200/254 байти через USB і UART ESP32. Нове фото оператора
показує підключене живлення HDR-60-5. Це не приймання PPP або керування через LTE.
Раніше ESP32 мав UART bridge; точна modem firmware уточнюється через `AT+CGMR`.

`SU600 ↔ UART1/RS485 ↔ ESP32 ↔ UART2/PPP ↔ A7670E/LTE ↔ TCP tunnel ↔ gateway ↔ backend ↔ сайт`.

- RS485: TX17/RX18, UART1, 9600/8N1, адреса SU600 1.
- Модем: TX4 → RX HAT, RX5 ← TX HAT, спільний GND, UART2, 115200.
- `PPP_MODEM_GENERIC` ESP32 core 3.3.1 використовує стандартний PDP/dial-up;
  конкретну ревізію A7670E потрібно випробувати. CMUX/RTS/CTS не вимагаються.
- Wi-Fi вимкнено. SNTP, TLS та ArduinoMqttClient працюють через PPP.
  CA записується в ESP32; окреме завантаження CA в модем для цього шляху не потрібне.
  Перевірки CA, імені сервера, часу, command TTL/sequence/anti-replay збережено.
- SU600 працює незалежною задачею; його STOP/network lease та NVS не замінюються.
- Зберігається UID цього фізичного стенда `KERUMO-V3-SU600-001`, прив'язка й історія.
  Інший фізичний контролер має отримати іншу ідентичність.
- Повтор ініціалізації має паузу 10 с; очікування registration обмежено 120 с,
  IP — 60 с. PWR/RESET HAT не підключено до firmware, тому апаратне відновлення
  завислого модема не гарантовано. Це потрібно перевірити окремо.
- RSSI отримується через успішний CSQ до data mode і використовується до 30 с;
  потім signal відсутній до нового вимірювання. CSQ=99 не перетворюється на число.

## Підготовка ПК

Потрібні Docker Desktop, наявні `.env.demo` та `.local/v3/identity.json`,
зареєстрований стенд і Windows OpenSSH Client. Скрипт не запускає seed/reset,
не стирає NVS, акаунти або історію. ReadOnly вимикає control/program/schedule
capabilities тільки цього стенда. Змінена прив'язка не переноситься автоматично.
Наявні `.env.v3`, `.env.controllers` та `.env.staff` автоматично підключаються:
customer/staff API зберігають розділення. Якщо staff service уже існує, а його
`.env.staff` втрачено, підготовка зупиняється до перебудови сервера.

Після злиття зміни оновіть репозиторій. У першому PowerShell відкрийте tunnel:

```powershell
ssh -p 443 -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -R0:127.0.0.1:8884 tcp@free.pinggy.io
```

Це raw TCP tunnel до **127.0.0.1:8884**; TLS завершується на вашому gateway.
Залиште термінал відкритим і збережіть адресу `tcp://hostname:port`.
[Pinggy](https://pinggy.io/) обмежує free tunnel 60 хвилинами й змінює адресу
після перепідключення; довгий прогін потребує стабільного endpoint.

У другому PowerShell, з кореня репозиторію:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-v4.ps1
```

Введіть повну TCP-адресу. APN за замовчуванням `internet`; інший передається
через `-Apn`. Скрипт збирає backend/gateway, створює `.local/v4` і приватний
`firmware/kerumo_v3/lte_config.local.h`, запускає окремий localhost gateway.
Сертифікат має SAN фактичного tunnel hostname. UID/password стенда, `.local/v3`
і Wi-Fi `config.local.h` збережено. Observer читає тільки вихідні теми стенда;
probe отримує observer credentials/CA без server/CA private keys.

Коли tunnel endpoint зміниться, перевірте адресу й запустіть:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-v4.ps1 -RenewEndpoint
```

CA/password залишаються, endpoint/leaf certificate оновлюються. Через нову адресу
в ESP32 потрібно повторно завантажити firmware. Приватні `.local`, `*.local.h`
та keys/passwords не публікувати. При неповній попередній підготовці скрипт
зупиняється зі збереженням файлів; їх потрібно оглянути перед повтором.

## Перше читання й сайт

В Arduino IDE відкрийте загальний скетч `firmware/kerumo_v3/kerumo_v3.ino`.
Core **3.3.1**, ArduinoJson **7.4.2**, ArduinoMqttClient **0.1.8**;
ESP32S3 Dev Module, Flash 16 MB, PSRAM OPI, partition 3 MB APP / 9 MB FATFS.
Для початкового USB-UART COM10 — USB CDC On Boot Disabled; для native USB
підтримується Enabled. Serial Monitor 115200; NVS/flash не стирати.

Очікуваний порядок: `V4 LTE ... Wi-Fi off` → `LTE: AT ready; firmware=...` →
`packet service attached` → `PPP address` → синхронізація UTC ESP32 →
`MQTT CONNECTED / TLS` → поточні `READ` і показання на сайті.
Перша LTE-конфігурація примусово read-only, навіть якщо стара Wi-Fi дозволяла control.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-v4.ps1
```

Probe нічого не публікує й не керує двигуном: чекає нові cellular telemetry/heartbeat,
перевіряє UTC/session, усі чотири вимірювання, стан SU600 та control_armed=false,
потім отриманий message_id і свіжий snapshot у PostgreSQL. Timeout — 90 с.
На сайті окремо перевірте «Мобільна мережа», свіжий час і відповідність показань
дисплею SU600. Старі або відсутні дані мають відповідну якість.

## Керування після читання

Збережено [умови SU600](v3-su600-extended-test.md) та
[правила commissioned operation](v3-remote-operation.md). LTE-підготовка не змінює
параметри F. Спочатку перевіряються STOP і готовність обладнання.

| ControlMode | Поведінка |
|---|---|
| ReadOnly | Початковий режим, Modbus writes вимкнені |
| Bench | Наявний ARM, межа 60 с, профіль без двигуна |
| Extended | Наявний ARM SU600 TEST і захисні перевірки; програми/розклади доступні |
| Remote | Наявні commissioned guards без Serial ARM; пуск лише новою командою |

Для підготовленого й прийнятого стенда режим вибирається явно:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-v4.ps1 -ControlMode Remote
```

Після підготовки повторно завантажити скетч. Перевірити STOP, частоту, START/STOP,
ACK/Result у журналі та фактичний readback. ACK — доставка, не виконання;
регістри не є незалежним вимірюванням обертання. Probe у цьому режимі приймає
`-AllowControl`, залишаючись спостерігачем. При втраті мережі ядро запитує STOP;
затримку на LTE треба виміряти. Календар потребує сервера, активні програми
підкоряються чинній політиці зупинки при втраті мережі.

## Межі й наступні випробування

LTE factory HTTPS enrollment/QR bootstrap ще не реалізовано; поєднання з
`factory_config.local.h` заборонене на compile. Драйвер — SU600, інші SUSWE
в каталозі не означають дозвіл керування. Нові енергомодулі/GNSS не додаються.

Потрібні холодний старт без USB; registration→PPP→UTC→TLS→MQTT; реальні дані
на сайті; команди/Result; network/gateway/RS485 loss; повернення без самопуску;
restart/NVS/дублікати й тривалий прогін. Електричне приймання шафи — окремо.

Діагностика: AT failed — UART/firmware; PPP failed/немає IP — APN/modem firmware;
IP без UTC — SNTP/DNS; UTC без MQTT — tunnel/CA/hostname/credentials;
MQTT без сайту — UID/envelope/backend logs. Надати boot Serial logs і `AT+CGMR`,
але не приватний конфіг. Software tests використовують імітацію edge на реальному
broker/backend і не підміняють фізичне приймання A7670E. Результати стенда
записуються після тестів із версіями, умовами, часом і журналами.

Технічна основа: [Waveshare A7670E](https://www.waveshare.com/wiki/A7670E_Cat-1/GNSS_HAT),
[SIMCom AT manual](https://files.waveshare.com/wiki/A7670E-Cat-1-GNSS-HAT/A76XX_Series_AT_Command_Manual_V1.09.pdf),
[ESP32 PPP](https://github.com/espressif/arduino-esp32/tree/3.3.1/libraries/PPP),
[TCP tunnel](https://pinggy.io/docs/tcp_tunnels/).
