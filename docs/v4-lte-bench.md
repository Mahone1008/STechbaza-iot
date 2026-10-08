# V4: SU600 через LTE на наявному сервері Windows

Firmware **0.9.0** додає програмну основу, **0.9.1** уточнює запуск SNTP
і діагностику RS485. На фізичному A7670E підтверджено AT, packet attach,
PPP IP/DNS, UTC і MQTT-підключення з verified TLS на 0.9.1, потім читання
конфігурації та показань SU600 після виправлення підключень. Фізичний
read-only probe підтвердив нові cellular повідомлення та свіжий snapshot
у PostgreSQL. На сайті підтверджено свіжі показання та зупинений стан.
Керування й recovery через LTE ще не прийнято.
V4 є стендом; V5 буде окремим виробом.
Наявний сайт і протокол збережено, нові екрани моніторингу не додаються.

Програмно перевірено: збірки ESP32-S3 LTE ReadOnly/Remote і Wi-Fi; native
STOP/TTL/replay/recovery та cellular deadlines; JSON telemetry/ACK/result за
контрактами backend; справжній TLS broker, відмова при неправильних CA/hostname,
паролях і topic ACL; імітована cellular telemetry до API, STOP→ACK→Result та
read-only observer із підтвердженням нового message_id у PostgreSQL.
Програмні результати не замінюють фізичне приймання A7670E/SU600.

## Фізичні докази 08.10.2026

Оператор надав Serial Monitor firmware **0.9.0** із відповідями:

```text
LTE: AT ready; firmware=+CGMR: A011B05A7670M7_F
LTE: packet service attached; starting PPP
LTE: PPP address=...; waiting for ESP32 UTC synchronization
```

Це підтверджує UART GPIO4/5, AT-відповідь зазначеної ревізії, packet attach
і PPP IP у цьому запуску. У цьому фрагменті немає строк успішного UTC або
`MQTT CONNECTED / TLS`. У тому самому журналі SU600 має `read=0` і `READ ... MISSING`;
оператор підтвердив увімкнений дисплей SU600. Причина відсутності Modbus
відповідей ще не встановлена. Показані `F*=0` за `read=0` не є підтвердженим
читанням нульових параметрів. Холодний старт, тривалий прогін і керування
через LTE цим доказом не закриваються.

Наступний журнал із діагностикою 0.9.1 показав `MQTT: reconnect failed (-2)`
і RS485 `requests=2 valid=0 no_reply=2 invalid=0 last_reg=0x0002 rx=0`.
У поточному коді MQTT спроба можлива лише після придатного UTC; окрема
строка успішної синхронізації у цьому фрагменті не показана. SU600 не дав
жодного UART RX байта за дві зафіксовані спроби, причина ще відкрита.
Read-only Python probe на ПК пройшов verified TLS до локального gateway
`127.0.0.1:8883`, а для зовнішнього Pinggy hostname отримав `Name does not resolve`.
Google і Cloudflare DNS незалежно повернули NXDOMAIN для цього тимчасового
імені. Потрібне поновлення TCP endpoint; успішний TLS з ESP32 цим не доведено.
Локальні з'єднання в gateway logs приблизно кожні 5 с відповідають TLS healthcheck,
який закриває сокет без MQTT CONNECT; EOF/Broken pipe цих з'єднань самі по собі
не доводять відмову сертифіката, зокрема при успішному verified TLS probe.

Після поновлення endpoint оператор надав новий запуск 0.9.1:

```text
LTE: AT ready; firmware=+CGMR: A011B05A7670M7_F
LTE: packet service attached; starting PPP
LTE: PPP address=...; waiting for ESP32 UTC synchronization
LTE: DNS main=... backup=...
LTE: ESP32 UTC synchronized; connecting to MQTT with verified TLS
MQTT CONNECTED / TLS: ESP32 IP=..., host=...:...
```

Wi-Fi вимкнено за конфігурацією LTE. У цьому запуску підтверджено фізичний
шлях UART/PPP/LTE → TCP tunnel → authenticated MQTT і subscription із
перевіркою CA/hostname/time. `MQTT CONNECTED` у коді друкується лише після
успішних connect/subscribe, але не доводить приймання telemetry у backend/БД
або показань на сайті. RS485 має `requests=1 valid=0 no_reply=1 rx=0`;
оператор підтвердив підключені 3V3/GND та світний індикатор перетворювача.
Точна напруга, UART/A/B і поточні F6 параметри ще не перевірені.
ReadOnly/storage=OK збережено. Команди двигуну та повне приймання не виконувалися.

Наступний журнал після зміни підключень має `read=1 profile=1 config=1`,
`guards_read=1 ready=1`, `F5.00=1001 (raw=4097)`, `F4.08=0`, `armed=0`.
Усі шість READ мають `OK`: fault=0, state=1290, set/output=0 Гц, I/U=0.
За SU600-драйвером стан 1290 і вихід 0 відповідають зупиненому приводу.
Підтверджено конфігураційні F0/F6 читання та поточні регістрові показання
у цьому фрагменті, але не незалежне вимірювання фізичного руху двигуна.
Оператор припустив переплутаний GPIO; точна початкова помилка монтажу
не задокументована. `last_stop=configuration_mismatch` зберігає причину
попередньої зупинки й не спростовує свіжі `config=1`/`READ ... OK`.
На цьому етапі наступною перевіркою був read-only `check-v4.ps1` для
кореляції нових cellular повідомлень, session/message_id і snapshot у PostgreSQL.

Оператор запустив `scripts/check-v4.ps1` і надав успішний результат:

```text
transport: cellular
message_id: a6d28286-c1d4-49e8-b092-cb5e72df000c
values: set_frequency_hz=0, frequency_hz=0, current_a=0, voltage_v=0
state: vfd_fault_code=0, pump_running=false, vfd_link=true,
       vfd_configuration_valid=true, control_armed=false
PASS: live LTE heartbeat + SU600 measurements accepted by backend.
```

UID — наявний `KERUMO-V3-SU600-001`. За контрактом probe цей PASS означає
нові non-retained heartbeat/telemetry зі спільною boot session, cellular transport,
UTC віком до 30 с, чотири скінченні показання й VFD readback; точний message_id
знайдено для цього Device у PostgreSQL, а поточний snapshot свіжий та read-only.
Фізично підтверджено шлях SU600 → RS485 → ESP32 → UART/PPP/LTE → TLS/MQTT
gateway → backend → PostgreSQL у цьому запуску. Нулі є прочитаними значеннями
зупиненого приводу, а не заміною MISSING. Probe не публікує команди;
START/STOP/частота/ACK/Result і UI/API відображення не доводяться цим PASS.

Після запуску клієнтського сайту оператор надав панель того самого Device:
«На зв’язку», «Свіжі дані», «Обладнання зупинено». Картки показують задану
та вихідну частоту 0 Гц, струм 0 А, напругу 0 В, код помилки 0 і стан
«Зупинено»; час перевірки панелі на дві секунди пізніший за час показань.
Разом із попереднім probe це підтверджує read-only шлях до сайту в цьому
запуску. Повідомлення «Для цього пристрою немає дозволених команд» відповідає
ReadOnly: серверні control/program/schedule вимкнені, firmware `armed=0`.
Назва V3 збережена разом із наявними UID, прив'язкою та історією.

Оператор підтвердив, що підключений той самий двигун і попередній захист
збережено після перенесення стенда. Це повідомлення про незмінну установку,
а не нове незалежне приймання моторного захисту. Наступні перевірки:
Remote-готовність, STOP і новий ручний пуск/частота/STOP із результатами,
холодний старт, втрати зв'язку без самопуску та тривалий прогін.

## Вихідний стан і транспорт

Досьє `KERUMO_V4_Dossier.docx` від 08.10.2026 описує успішні AT, реєстрацію
Kyivstar та HTTP 200/254 байти через USB і UART ESP32. Нове фото оператора
показує підключене живлення HDR-60-5. Це не приймання PPP або керування через LTE.
Раніше ESP32 мав UART bridge; поточний фізичний журнал уточнив modem firmware
до `A011B05A7670M7_F`.

`SU600 ↔ UART1/RS485 ↔ ESP32 ↔ UART2/PPP ↔ A7670E/LTE ↔ TCP tunnel ↔ gateway ↔ backend ↔ сайт`.

- RS485: TX17/RX18, UART1, 9600/8N1, адреса SU600 1.
- Модем: TX4 → RX HAT, RX5 ← TX HAT, спільний GND, UART2, 115200.
- `PPP_MODEM_GENERIC` ESP32 core 3.3.1 використовує стандартний PDP/dial-up;
  конкретну ревізію A7670E потрібно випробувати. CMUX/RTS/CTS не вимагаються.
- Wi-Fi вимкнено. SNTP, TLS та ArduinoMqttClient працюють через PPP.
  CA записується в ESP32; окреме завантаження CA в модем для цього шляху не потрібне.
  Перевірки CA, імені сервера, часу, command TTL/sequence/anti-replay збережено.
- У 0.9.1 SNTP стартує після отримання PPP IP і вибору default route, також
  після reconnect. Без придатного UTC запит повторюється через 60 с, TLS/MQTT
  залишаються заблокованими. Період синхронізації 30 хв у Wi-Fi/LTE менший
  за незмінну годинну межу віку часу; default core 3.3.1 був 3 години.
  Успіх UTC і повторне очікування мають окремі Serial повідомлення;
  при отриманні PPP IP журнал показує main/backup DNS без credentials.
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
ssh -4 -p 443 -o PubkeyAuthentication=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -R0:127.0.0.1:8885 tcp@free.pinggy.io
```

Це raw TCP tunnel до **127.0.0.1:8885**; TLS завершується на вашому gateway.
Порт 8885 відокремлено від наявного factory gateway 8884.
`-4` обирає IPv4; `PubkeyAuthentication=no` не використовує особисті SSH-ключі.
Якщо Pinggy запитає пароль `tcp@free.pinggy.io`, натисніть Enter із порожнім
полем, як зазначено в [офіційній інструкції](https://pinggy.io/docs/).
Запит `Enter passphrase for key ...id_ed25519` стосується локального ключа:
скасуйте його Ctrl+C та використайте команду вище.
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
`packet service attached` → `PPP address` → `ESP32 UTC synchronized` →
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

Перед ручним випробуванням призупинити увімкнені розклади: Remote підготовка
також повертає можливості програм і розкладів. Для чинного tunnel можна
передати збережені host/port/APN замість повторного введення адреси:

```powershell
$v4Connection = Get-Content -Raw -LiteralPath '.\.local\v4\identity.json' |
    ConvertFrom-Json | Select-Object host, port, apn
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-v4.ps1 -BrokerHost $v4Connection.host -BrokerPort $v4Connection.port -Apn $v4Connection.apn -ControlMode Remote
if ($LASTEXITCODE -ne 0) { throw 'V4 Remote preparation failed; do not upload yet.' }
```

Це не поновлює прострочений tunnel: для нової адреси потрібний описаний вище
`-RenewEndpoint`. Не виводити повний private identity або LTE header.

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
на сайті після нового boot; команди/Result; network/gateway/RS485 loss; повернення без самопуску;
restart/NVS/дублікати й тривалий прогін. Електричне приймання шафи — окремо.

Діагностика: AT failed — UART/firmware; PPP failed/немає IP — APN/modem firmware;
IP без UTC — SNTP/DNS; UTC без MQTT — tunnel/CA/hostname/credentials;
MQTT без сайту — UID/envelope/backend logs. Надати boot Serial logs і `AT+CGMR`,
але не приватний конфіг. Software tests використовують імітацію edge на реальному
broker/backend і не підміняють фізичне приймання A7670E. Результати стенда
записуються після тестів із версіями, умовами, часом і журналами.

За `SU600 read=0` firmware 0.9.1 додає Serial `RS485`: число запитів,
коректних відповідей, відсутніх і некоректних відповідей, останній регістр
та кількість збережених байтів останнього RX (до 16). Це лічильники від boot,
включно з конфігураційними запитами; нових запитів або записів не додається.
`no_reply` указує на мовчання UART peer; `invalid` також охоплює CRC/формат
або exception, тому сам лічильник не встановлює причину. Спочатку перевірити
живлення перетворювача, TX17→RX/RX18←TX, GND, A/B та наявні F6 налаштування;
не змінювати параметри F лише через `MISSING`. Пауза drain після помилки
лишилася 250 мс, але тепер відраховується лише після помилки й коректно
працює через переповнення millis. Native тест actual adapter перевіряє
мовчання, правильний нуль, CRC/exception, ReadOnly без FC06 і timeout/drain
через переповнення таймера.

Технічна основа: [Waveshare A7670E](https://www.waveshare.com/wiki/A7670E_Cat-1/GNSS_HAT),
[SIMCom AT manual](https://files.waveshare.com/wiki/A7670E-Cat-1-GNSS-HAT/A76XX_Series_AT_Command_Manual_V1.09.pdf),
[ESP32 PPP](https://github.com/espressif/arduino-esp32/tree/3.3.1/libraries/PPP),
[TCP tunnel](https://pinggy.io/docs/tcp_tunnels/).
