# Етап 11.2 — список пристроїв та обмежені перевірки зв’язку

Дата: 28.09.2026. Реалізовано разом із [11.1](stage-11-op1-organizations-sites.md).

**Код, локальні перевірки та повний Chromium CI готові й успішні.
Користувацьке Windows-приймання очікується; операції не закрито.**

## Поведінка й бюджет запитів

- Справжній `GET /sites/{id}/devices`: назва, UID, тип, lifecycle status,
  UUID-посилання, 20 видимих рядків і один lookahead.
- Availability тільки для видимих пристроїв: максимум **4 одночасні запити**,
  timeout одного GET — 5 секунд. Lookahead та решта парку не опитуються.
- Фонових polling timers немає: відкриття сторінки або «Оновити зв’язок».
  Час перевірки видимий. Старий Online прихований під час нової перевірки.
- Зміна сторінки, контексту й logout скасовують запити/чергу; worker після
  abort не бере наступний пристрій. Query key містить user, session, org,
  site, resource і page. Cache списків видаляється після від’єднання observer.
- «Оновити список» повторно перевіряє список і availability. Placeholder
  попередньої сторінки немає. Availability query retry вимкнено; auth adapter
  зберігає одноразовий GET replay на 401. Жодних command/write requests.

| Відповідь | Відображення |
|---|---|
| `online=true`, валідний `last_seen_at` | Online |
| `online=false`, відомий `last_seen_at` | Offline |
| `last_seen_at=null` | Ще не було зв’язку |
| Network/timeout/5xx/429/некоректна availability | Стан невідомий; ручне оновлення |
| 403/404 availability | Рядки приховано, помилка й шлях відновлення |

Час показаний у timezone об’єкта, з UTC fallback для невідомого timezone.
**Online не означає свіжу телеметрію, активний lifecycle або фізичну роботу
насоса.** Немає вигаданих fleet totals, alarm counters чи чисел сенсорів.

`/devices/{UUID}` показує справжню identity й availability. Модулі/канали —
11.3, quality/config/revoke — 11.4, реальні команди — Етап 12. Невідомий ID
більше не відкриває перший demo device. Демонстраційна панель перенесена до
`/ui-kit/device-demo`, явно позначена; її permission/confirmation регресії
збережені. `/alarms` поки демонстраційний.

## Спільна перевірка у Windows

Зупинити попередній Next.js через `Ctrl+C`. Docker Desktop — Linux containers.
У корені repository:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage11-op1-op2.ps1 -Start
```

Скрипт ASCII-сумісний із Windows PowerShell 5.1. Накопичувальний gate 10.4
запускає **всі актуальні** unit, mocked і live suites, чисту збірку й OpenAPI
zero-diff. Існуючі `.env.demo`, passwords і volumes зберігаються. Passwords
не друкуються; автоматичного reset немає.

Очікуваний фінал:

```text
PASS: Stage 11.1-11.2 organizations, sites, validated context, paginated devices and bounded presence.
```

Після PASS `-Start` запускає <http://127.0.0.1:3000/login>.

1. Звичним demo owner обрати організацію → об’єкт → пристрої.
2. Перевірити реальні UID, lifecycle і зв’язок; натиснути «Оновити зв’язок».
3. Відкрити пристрій: справжня назва/UID, без вигаданих telemetry values
   або кнопок реальних команд. Повернутися через breadcrumbs.
4. F5 і `/devices`: вибір відновлюється після перевірки API.
5. Повторити на вузькому екрані; перевірити вихід у двох вкладках.

Demo seed має одну owner-організацію й п’ять її пристроїв. Мультисторінкові
каталоги, два доступні tenants і повільні відповіді перевіряє mocked suite;
live suite — реальну tenant isolation. Simulator для тестів не потрібен:
нові/історичні пристрої законно можуть бути без зв’язку або Offline.
Живий heartbeat доступний через вже налаштований demo simulator.

## Докази

| Gate | Результат |
|---|---|
| OpenAPI | 0.38.0 / 47 paths, контракт не змінено |
| TypeScript strict / ESLint / production build | PASS локально та в CI |
| Vitest | **31 passed**, локально та в CI |
| Mocked Chromium | **38 passed**, без retries/flaky |
| Live Chromium | **10 passed**, без retries/flaky |
| Windows PowerShell 5.1 / ручне приймання | Очікується від користувача |

Повний [Frontend checks #36426003363](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36426003363)
завершився **success** для code revision
[`cf25371`](https://github.com/Mahone1008/STechbaza-iot/commit/cf253717a1df84aa63d5905c5bb3f9fef20b50e3).
Jobs: `frontend` — `108939990743`, `auth-live` — `108940915243`.
Production build, OpenAPI generation zero-diff, mock та live suites пройдено.
Попередній [прогін основної реалізації](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36425515807)
також успішний: 31 / 37 / 10; фінальна версія додала mobile inventory regression.
Окремий наступний documentation commit лише фіксує ці докази.

Локальне середовище не має Docker/PowerShell і придатного Chromium;
браузерні та live прогони виконуються в GitHub Actions. Backend executable
code і міграції не змінені; останній повний backend CI наведений в
[огляді після Етапу 10](project-review-after-stage10-2026-09-28.md).

Після підтвердженого Windows PASS можна закрити 11.1/11.2, оновити прийнятий
прогрес до 10/24 і перейти до **11.3 — registry віджетів модулів/каналів**.
