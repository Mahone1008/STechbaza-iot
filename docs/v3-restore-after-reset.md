# Повернення фізичного V3 після очищення demo

Для backend **0.50.0**, schema **0027**, уже налаштованого ESP32-S3/SUSWE SU600 з UID `KERUMO-V3-SU600-001`. [Запуск клієнтського й службового сайтів](staff-console-v1.md), [попередня підготовка V3](v3-su600-bench.md).

## Що повертається

Очистка `start-staff-demo.ps1 -ResetExisting` залишає акаунти, паролі, порожні організації й членства, але видаляє об'єкти та пристрої. Фізичний стенд раніше був у «DEMO: клієнт A». `owner@kerumo-demo.example.com` має доступ як власник цієї організації; `admin` теж бачить її в межах своїх прав. Email і особистий пароль не зберігаються в ESP32. Прошивка використовує UID, мережеві credentials та параметри обладнання.

Наведений нижче порядок відновлює лише серверну картку V3 та його gateway. Він не змінює логіни/паролі, прошивку, сертифікати, Wi-Fi або параметри SU600. Керування, програми й розклади залишаються вимкненими. Оновлені backend і firmware 0.8.0 узгоджують серверний лічильник команд зі свіжою телеметрією ESP32, щоб нові команди після reset не конфліктували зі збереженим журналом. NVS не потрібно стирати. Нові показання надійдуть від фізичного ESP32; симулятор не запускається, а видалена історія не відтворюється.

## Команди Windows

Передумови: Docker Desktop працює, два API вже запущені за інструкцією службового кабінету, збережені `.env.demo`, `.env.v3` і `.local/v3/mosquitto.conf`; організація A існує та активна. Використовуйте чинний LAN/IP і конфігурацію попереднього V3.

Вставте весь блок у PowerShell. Це безпосередній блок команд, тому налаштування дозволу запуску `.ps1` для нього не потрібне:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Users\seraf\Documents\TechBaza\techbaza-iot'
    if (-not (Test-Path '.env.v3')) { throw 'Missing .env.v3: existing V3 setup is required.' }
    if (-not (Test-Path '.local/v3/mosquitto.conf')) { throw 'Missing saved V3 gateway configuration.' }
    $dc = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
    foreach ($overlay in @('v3', 'controllers', 'staff')) {
        if (Test-Path ".env.$overlay") {
            $composeFile = "compose.$overlay.yml"
            if ($overlay -eq 'staff') { $composeFile = 'compose.staff.demo.yml' }
            $dc += @('--env-file', ".env.$overlay", '-f', $composeFile)
        }
    }
    & docker @dc exec -T backend python -m app.bench.su600 --disable-control
    if ($LASTEXITCODE -ne 0) { throw 'V3 registration failed.' }
    & docker @dc up -d --no-deps --no-build v3-gateway
    if ($LASTEXITCODE -ne 0) { throw 'V3 gateway startup failed.' }
}
```

У результаті реєстрації очікуються `uid: KERUMO-V3-SU600-001` і `control_enabled: false`. Змінений UID, перенесений об'єкт або відсутня/архівована організація не перепризначаються автоматично: helper зупиняється з помилкою. `up` запускає тільки `v3-gateway`; клієнтський API зі staff overlay та зупинений симулятор не перестворюються. Не запускайте `-ResetExisting` повторно після відновлення: він знову видалить картку стенда.

## Перевірка в браузері

1. Відкрийте <http://127.0.0.1:3000/login>, увійдіть `owner@kerumo-demo.example.com` зі своїм чинним паролем. `superadmin` та `service` входять на `3001`.
2. Виберіть «DEMO: клієнт A» і оновіть сторінку. Має з'явитися об'єкт «V3 — фізичний стенд SU600» і контролер «V3 — реальний SU600 / ESP32-S3».
3. Відкрийте панель контролера. Коли ESP32 підключений до свого Wi-Fi/TLS gateway та надсилає дані, перевірте зв'язок, час останніх показань, частоту, струм і стан SU600. Саме існування картки не підтверджує фізичного зв'язку.
4. Кнопки пуску/керування не повинні бути доступні. Режим читання потрібен для перевірки відновленого зв'язку. Для керування без повторного ARM виконайте [налаштування firmware 0.8.0](v3-remote-operation.md). Ручний режим лишається в [інструкції стенда з двигуном](v3-su600-extended-test.md).

Якщо картка є, але зв'язку немає, перевірте Serial Monitor ESP32 на 115200 і журнали **V3 gateway та backend** через `docker @dc logs --tail 60 v3-gateway backend` у тому самому вікні PowerShell після успішного блока. Для приватних паролів/конфігурації не використовуйте `docker inspect` у публічному звіті. Нова firmware потребує [фізичної перевірки remote operation](v3-remote-operation.md#перевірка-на-стенді) та, для factory provisioning, [приймання етапу 2](stage2-acceptance.md); ця інструкція не оголошує їх виконаними.
