# Поточний стан KERUMO

Оновлено **30.09.2026** після аудиту документації, коду та CI.
Це поточний реєстр стану; датовані досьє зберігають історичні докази.
[Версії/схема/API/канали/права з коду](generated-code-reference.md),
[звіт аудиту та точні CI revisions](audit-2026-09-30.md).

## Що реалізовано і що прийнято

| Область | Поточний результат | Межа |
|---|---|---|
| Backend | Real auth/RBAC, tenant isolation, telemetry/history, commands, alarms, notifications; integration/restore CI | Локальний single-process runtime, не production scale |
| Команди | Outbound v2, monotonic sequence, Stop ordering, HTTP idempotency, TTL, late replies, перевірка прав і frequency profile при dispatch | ACK/Result — повідомлення edge; не незалежний фізичний вимір |
| Frontend | Етапи 9–14 реалізовано; реальні API, polling, command journal | Повністю прийнято 10/24 операцій; залишок manual acceptance у roadmap |
| V3 читання | ESP32-S3 N16R8 → SU600 → Wi-Fi/TLS → API/UI підтверджено | Це конкретний SU600 profile, не всі SUSWE/RS485 моделі |
| V3 керування | Частота 20→30 Гц, START/STOP, повторний пуск; оператор підтвердив обертання/зупинку | Не прийнято повний діапазон/навантаження/польові умови |
| V3 зупинки | Gateway loss, Serial DISARM, знеструмлення ESP32; повернення без самозапуску в описаних циклах | Wi-Fi radio loss, RS485 fault matrix і точні затримки окремо не виміряні |
| V4 | Роботу відкладено | Очікуємо 4G-модуль; LTE не реалізовано/не перевірено |

Докази: [читання](dossier-v3-su600-read-only-bench.md),
[керування та зупинки](dossier-v3-su600-control-bench.md),
[frontend roadmap](frontend-roadmap-v1.md), [P0–P9](product-readiness-plan-v1.md).

## Поведінка, яку не слід плутати

- Backend application 0.39.0, schema head 0018; firmware V3 0.2.1.
  Номер API `/v1`, версія застосунку та MQTT `schema_version` — різні речі.
- Outbound command — v2; telemetry, heartbeat, ACK і Result — v1.
- TTL типово 30 с, 5–300 с: час першого прийняття, не таймер RUN.
- `ARM SU600` — короткий bench із 60-секундною зупинкою. `ARM SU600 TEST`
  у явно дозволеному EXTENDED не має цього таймера; штатний STOP зберігає ARM.
  Fault, network loss, DISARM/reboot знімають дозвіл. [Точна процедура](v3-su600-extended-test.md).
- Панель типово 5 с, history 60 с, перша сторінка журналу 5 с.
  Під час фонового refresh показання залишаються з власною давністю;
  history приховує старий графік лише під час власного reload.
- Online ESP32 не означає справний RS485/VFD, а heartbeat не оновлює стару telemetry.
- `telemetry_keys` обмежує overview/series; MQTT ingestion перевіряє registry
  і enabled capability. Цей фільтр відображення не є device ACL.
- F5.00 SU600A — packed digits (`1001` на панелі ↔ `0x1001` / raw 4097).
  Числові F6.02 та інші звичайні регістри так не декодуються.
- Для струму звіряли d-04; початкове згадування d-02 як струму було помилкою.
  Нуль на сайті та панелі не доводить «супермалий струм»; метрологія не прийнята.

## Відкриті питання та порядок робіт

| ID | Питання | Що закриє його |
|---|---|---|
| V3-01 | Offline після тривалої відсутності: SU600 вимикали, ESP32 лишалася USB; допомогло перепідключення плати | Відтворення з Serial/Wi-Fi/MQTT/NTP/PC sleep timestamps; root cause та повтор після виправлення |
| V3-02 | Окрема втрата Wi-Fi, RS485, clock/storage/profile faults і довгий RUN/soak | Погоджена fault matrix, виміряні затримки та контрольовані повтори |
| V3-03 | Після ESP power-loss останній запис містить STOP, ARM=0, fault 16/E485 | Окремо зафіксоване усунення причини/відновлення; автоматичного fault reset немає |
| V3-04 | Налаштування захисту двигуна/установки, повний BOM і електрична схема | Перевірені інженером параметри й незалежна зупинка; повний hardware acceptance |
| UI-01 | Решта manual сценаріїв 11.3–14.4, F5 history filters, F5 під RUN, multi-role/mobile/a11y | Checklist із конкретними revision, очікуванням та доказами; CI не закриває його автоматично |
| PROD-01 | TLS/identity вже є на V3 gateway, але fleet provisioning/rotation/revocation та transfer/config lifecycle неповні | Реалізація й приймання P1/P2 |
| PROD-02 | Deployment, процеси/worker ownership, production settings, logs/metrics, DB retention/PITR | P5, restore/release rehearsal, виміряні RPO/RTO |
| PROD-03 | OTA, незалежний security review, load/reconnect/soak, pilot/support/conformity | P6–P9 з окремими доказами |
| CODE-01 | Python dependency lock/audit та lint/type gate; великі MQTT/auth adapters, щільний C++ adapter | Окремі поведінково нейтральні зміни з regression gate; не масове форматування під час bench |
| NEXT-01 | Таймери/програми частоти, service editor F-параметрів, синхронізація LOCAL/REMOTE switch ↔ сайт | Узгоджений protocol/config/RBAC/safety design і наступна реалізація |
| V4-01 | Модуль 4G ще не отримано | Модель/revision/BOM, transport design та LTE recovery acceptance після доставки |

V3-01 не закрито успішним gateway-тестом: це різні сценарії.
Не знижуємо захист UTC/TTL для маскування невстановленої причини Offline.
Читання нульового струму, один успішний пуск або один power cycle не є
випробуванням точності, довговічності чи всіх захистів.

## Оцінка готовності

Код має добру перевірену основу: розділення backend шарів, tenant guards,
server-side sessions, durable command lifecycle, generated API, strict TS,
CI з реальними PostgreSQL/MQTT/browser та native firmware tests.
Це підстава продовжувати розробку продукту, але не заявляти відповідність
усім стандартам, готовність до 10 000 контролерів або завершений commercial release.
Критерій переходу далі — закриття конкретних пунктів вище, а не оцінка «ідеальний код».
