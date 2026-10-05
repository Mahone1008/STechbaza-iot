# Покупець, заводський реєстр і QR: контракт етапу 2

Звірено з кодом 05.10.2026: backend 0.46.0, міграція `20261005_0023`,
frontend із реальними API, firmware 0.7.0. Програмний цикл
[погодженого етапу 2](next-stage-plan-vfd-service-qr.md) реалізовано.
Фізичне приймання ESP32/SU600 із телефоном лишається окремим кроком.

## Обліковий запис

- `/register` створює користувача з platform role `user`. Пароль — 12–128
  символів; реєстрація забороняє пробіли на початку/в кінці. Організація
  й об'єкт на цьому кроці ще не створюються.
- Одноразово показаний recovery key потрібно зберегти. `/recover` перевіряє
  email і ключ, змінює пароль, відкликає всі сесії, скидає TOTP та видає
  новий recovery key. Старий ключ перестає діяти. Email reset/verification немає.
- `/account/security` дозволяє налаштувати TOTP, замінити recovery key,
  переглянути до 100 активних сесій і відкликати власну сесію. Чужі сесії
  через цей API недоступні. Налаштування потребує пароля й, якщо MFA вже
  ввімкнено, нового OTP. TOTP: 6 цифр, період 30 с; повтор коду відхиляється.
- Після підтвердження TOTP інші сесії відкликаються, поточна стає
  MFA-verified. Наступний login з увімкненим MFA потребує `otp`.
- Привілейовані platform roles `superadmin`/`service_admin` і tenant roles
  `owner`/`admin`/`service` потребують перевіреної MFA-сесії при публічному
  browser origin. Для прямого локального backend можна явно ввімкнути
  `AUTH_REQUIRE_PRIVILEGED_MFA=true`. Заводський API вимагає MFA завжди,
  включно з demo. Створення власного об'єкта через claim також перевіряє
  політику майбутньої ролі `owner`.
- Membership API підтримує обмеження доступу до об'єктів `site_ids` і
  строк `expires_at`; owner лишається постійним і без site scope.
  [Точні правила](membership-management-v1.md). Повного service/admin UI ще немає.

Browser registration/recovery мають exact Origin і `X-TechBaza-CSRF: 1`;
account operations використовують спільний auth throttle. Access JWT
лишається в пам'яті, refresh — у HttpOnly cookie. Контракти:
[browser auth](browser-auth-v1.md), [ключі й міграція](account-key-operations-v1.md).

## Завод і оптовик

Сторінка `/factory` доступна `superadmin` із MFA-verified session.
Реєстр зберігає serial, hardware model/revision, batch та посилання на
протокол заводської перевірки. Реєстрація потребує явного
`factory_test_passed: true`; API фіксує підтвердження оператора, не виконує
електричний тест контролера автоматично.

Відповідь створення містить `qr_path=/connect/{controller_id}`, окремий
activation code і приватний bootstrap key. UI дозволяє завантажити їх у
заводський JSON-комплект. Секрети повторно не показуються; повтор serial
дає 409 без заміни ключів. **Публічний URL не містить ключів.** Код активації
має передаватися покупцеві окремо; bootstrap key лишається приватним.
UI генерує QR-зображення та окремий public print; factory JSON також містить
унікальний setup password. `app.tools.factory_config` створює приватний
`factory_config.local.h` із HTTPS origin і CA без перезапису чинного файлу.

Передача оптовику — запис отримувача/документа для неприв'язаного
контролера. Вона не надає роль або доступ до даних покупця. Аудит реєстрації,
постачання, claim та вибору обладнання доступний через factory API.

## Прив'язка покупця

1. Відкрити `/connect/{controller_id}` із QR або ввести URL/UUID на `/connect`.
   Після входу/реєстрації frontend повертається до цього контролера.
2. Ввести окремий activation code, назву контролера та створити новий
   об'єкт із часовим поясом (типовий варіант) або вибрати власний наявний.
   Список наявних об'єктів фільтрується за `device.create` і scope **до** пагінації.
3. Claim під блокуванням атомарно створює персональну організацію з owner
   за потреби, Site та Device у `provisioning`, витрачає activation code
   і зберігає аудит. Повтор claim власного контролера повертає чинну
   прив'язку без другого об'єкта. Чужа прив'язка недоступна за QR.
4. Обрати профіль/модель/ревізію та підтвердити шильдик. Створюється
   паспорт модуля `vfd-1`; повтор із тими самими даними ідемпотентний,
   інші дані дають 409. Потрібне `capability.manage`.

Вибір паспорта **не** застосовує manifest у прошивці, не додає автоматично
дозвіл RUN і не доводить зв'язок RS485. Чинний commissioning описано в
[equipment foundation](equipment-foundation-v1.md). SU600 має драйвер;
інші шість серій SUSWE є в каталозі без прийнятого керування.

## Bootstrap і незавершений фізичний шлях

`POST /api/v1/bootstrap/{controller_id}/contact` приймає
`Authorization: Bearer <bootstrap_key>` і `firmware_version`. Успішна
перевірка оновлює час контакту/версію та повертає стан прив'язки.
Це окремий device secret, не JWT користувача. Відповідь не видає MQTT
credentials, не застосовує equipment manifest і не запускає мотор.

Firmware **0.7.0** у factory build використовує окремий endpoint
`POST /bootstrap/{id}/configuration`: bootstrap bearer, firmware version;
response — `waiting|configured|revoked`, UID, MQTT host/port/password,
credential revision та точні canonical manifest bytes/hash. Відповіді
`no-store`; не використовується browser JWT. Legacy `/contact` збережено
для сумісності, але він сам не видає credentials.

Setup: WPA2 SoftAP з унікальним паролем, BOOT 3 секунди після локального
STOP, ручна адреса `http://192.168.4.1`, таймаут 10 хвилин, Host/Origin/CSRF
перевірки; Wi-Fi password лишається в NVS. До вибору сумісного manifest
factory build не виконує VFD I/O. Новий hash/UID потребує локального
підтвердження, читання STOP/0 Гц і згоди на binding. Немає RUN endpoint.

## Credentials, заміна й передача

- Mosquitto Dynamic Security: TLS, credentials/client ID окремого Device,
  точні MQTT ACL. Encrypted secret з окремим encryption purpose під
  ACCOUNT_KEY_SECRET. Durable desired/applied revision повторюється worker
  після збою; API не оголошує broker revoke завершеним до ACK.
- Owner/admin/service із capability.manage можуть керувати MQTT-доступом
  у дозволеному Site, з повторним password/TOTP proof. Відкликання дозволене
  offline; це не підтвердження зупинки. Ротація розриває стару активну сесію.
- `equipment/replacement`: expected module/revision, причина та явне
  підтвердження. Свіжі STOP/0 Гц/DISARM, без enabled schedules і pending
  commands. Старий модуль архівний, новий має інший ID; керування заблоковане
  до нового manifest, локального binding і commissioning.
- Початковий manifest і manifest після вже зафіксованої безпечної заміни
  дозволено підготувати без нової телеметрії. Це не надає RUN: потрібні
  readback того самого hash, свіжий STOP та явний режим використання.
- `equipment/commission`: read_only за замовчуванням; стендовий режим без
  двигуна або explicit extended test. Extended потребує паспорта двигуна;
  локальний ARM і hardware guards ніколи не обходяться.
- Release — тільки owner або superadmin: proof, свіжий STOP, відсутність
  активних розкладів/команд, відгук MQTT до ACK, потім новий activation code.
  Старий Device retired; наступний claim створює нові UID/Device, без history.
  Втрата одноразового response потребує factory reissue, а не відкритого GET ключа.
- Factory quarantine відкликає bootstrap/activation/MQTT. Після фізичного
  повторного тесту factory reset видає новий комплект для перепрошивки;
  мережевий кеш старого покупця очищується, safety journal переприв'язується
  тільки після локального STOP. Старі tenant-дані не видаляються.

Точні Windows команди, backup шлюзу та фізичне приймання:
[stage2-acceptance](stage2-acceptance.md). Програмний цикл реалізовано;
повне hardware acceptance 0.7.0, LTE, production certificate lifecycle,
secure boot/flash encryption та масштабування залишаються окремими роботами.

## Навігація пристрою

`/devices/{device_id}?view=…` має розділи `panel`, `charts`, `schedules`,
`journal`, `equipment`: «Панель», «Графіки», «Розклади», «Журнал», «Обладнання».
Вибір розділу зберігається в URL після F5; уже відкриті форми лишаються
змонтованими при переходах у межах картки. F5 не зберігає незаписані чернетки.
Приховані розділи призупиняють свої періодичні запити. Паспорт і розгорнута
діагностика знаходяться в «Обладнанні»; журнал містить команди та події.

## Перевірки

Backend integration suite перевіряє реєстрацію/recovery/TOTP, MFA policy,
factory та claim concurrency/idempotency/tenant guards. Browser regressions
перевіряють форми реєстрації, відновлення, security/factory і claim;
вони використовують mocked API. Live browser suite окремо перевіряє
auth/session та інцидент MQTT, але ще не доводить фізичний buyer onboarding.
Поточні результати й межі — у [звіті 05.10](audit-2026-10-05-documentation.md).
