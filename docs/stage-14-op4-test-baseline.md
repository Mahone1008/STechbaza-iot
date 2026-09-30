# Етап 14.4 — Тестова база frontend і досьє

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата: **29.09.2026**. Разом із [14.3 — security/performance](stage-14-op3-security-performance.md).

**За уточненням користувача це базова версія перед подальшими тестами,
не production-реліз.** `npm run build` означає технічний спосіб збірки;
він не є рішенням про введення в експлуатацію. Release/tag/deployment
у цій операції не створюються. Загальне [досьє V3.5 Етапу 14](dossier-v3.5-stage-14-frontend-test-baseline.md).

## 1. Перевірки та provenance

**Фінальний CI — PASS** на code revision
[`d51841d848d0bb66eec9cb9dbd09d2b94c5a2e13`](https://github.com/Mahone1008/STechbaza-iot/commit/d51841d848d0bb66eec9cb9dbd09d2b94c5a2e13).
Реалізація — `aea94d9`; `d51841d` виправляє setup двох нових tests.
[Run 36535454970](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36535454970),
[frontend job 109298342943](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36535454970/job/109298342943),
[live job 109300917845](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36535454970/job/109300917845).
Обидва jobs завершилися `success`.

| Перевірка | Фактичний результат |
|---|---|
| OpenAPI | 0.38.0 / 47 paths, export + generation zero diff |
| Typecheck / ESLint / production build | PASS |
| Unit/component | **90 passed**, 16 files |
| Mocked Chromium | **152 passed**, 17 files, 5.1 min; 0 flaky / 0 skipped |
| Додаткові повтори | **44 passed**: 10 login + 15 overview + 9 history + 10 Retry-After; retries 0 |
| Live backend/browser/MQTT | **10 passed**, 1.0 min; incident/read/ACK/recovery chain PASS |
| Accessibility | **27 axe scans / 0 violations**; 8 incomplete scan/rule pairs, ті самі ручні межі, що в 14.1 |
| Dependency audit | **0 vulnerabilities** разом із dev dependencies; 482 dependencies за npm metadata |
| Візуальний перегляд | Свіжі CI screenshots: desktop device, 320px device, confirmation; styles/focus відображаються |

Зафіксовані performance measurements (CI Node **22.16.0**, Chromium,
mocked API; метод і бюджети — у 14.3):

| Показник | Факт | Gate |
|---|---:|---:|
| JS gzip, усі 24 chunks | 266 392 bytes | ≤ 358 400 |
| Найбільший JS chunk gzip | 71 628 bytes | ≤ 122 880 |
| Готовність панелі | 1 546 ms | < 8 000 |
| Історія, 672 buckets | 443 ms | < 4 000 |
| Початкові API requests без OPTIONS | 9 | ≤ 14 |
| DOM nodes щільної історії | 9 748 | < 15 000 |
| Heap після 2 warm-up cycles | 6 126 176 bytes | базова точка |
| Heap після наступних 6 cycles | 6 684 840 bytes | < 100 663 296 |
| Heap приріст | 558 664 bytes | < 16 777 216 |
| Page errors / CSP violations при navigation | 0 / 0 | 0 / 0 |

Точний [JSON snapshot доказів](evidence/stage-14-baseline-2026-09-29.json)
збережений у git, включно з build chunks, budgets, request paths і audit
metadata. Він належить до `d51841d`, не до майбутніх змін у main.
Локально також пройдені 90 unit/types/lint/build/budget та HTTP-перевірка
`/login`: fresh nonce, усі 13 script tags з nonce, `no-store`, без X-Powered-By.

CI виконує `npm ci`, OpenAPI export/generation/zero-diff, types, lint,
unit, production build, bundle budget, dependency audit, mocked browser,
44 повтори попередніх race/polling/Retry-After регресій без retries і окремий
live job з новим demo DB/backend/MQTT simulator. Mocked та live не змішуються.

### Історія перевірки 14.3–14.4

Перший run [`36534512798`](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36534512798)
на `aea94d9`: **150 passed / 2 failed**, live не запускався. Обидва
падіння в нових security tests досліджено за traces:

- CSP test створював script через DevTools evaluation замість ін'єкції
  у початковий HTML. Виправлено модель: parser-inserted script у HTTP body
  без зміни CSP headers, окремі assertions для script і handler.
- Logout test мав лише один app history entry; `replace` під час logout
  залишав для Back `about:blank` (підтверджено trace). Тепер перед notification
  відкривається інша protected page і перевіряється Back саме до неї.

Політику CSP, timeout/budget та перевірки приватних даних не послаблювали.
Повний повторний run `36535454970` на `d51841d` завершився PASS,
включно з обома security cases та live job.

## 2. Windows: одна команда

Docker Desktop має працювати в Linux containers mode. Зупинити попередній
frontend через **Ctrl+C**, потім вставити весь блок у PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\Users\seraf\Documents\TechBaza\techbaza-iot
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Git update failed.' }
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage14-op3-op4.ps1 -Start
    if ($LASTEXITCODE -ne 0) { throw 'Stage 14 test baseline verification failed.' }
}
```

Wrapper проходить попередній cumulative gate з актуальними suites,
guarded MQTT demo, bundle budget та npm audit. Наявні demo credentials,
volumes та історія зберігаються. MQTT scenario обмежений demo-обладнанням.
`-Start` після PASS запускає **зібрану** версію через `npm.cmd run start`
на <http://127.0.0.1:3000/login>. Це локальна перевірка production mode,
а не публічний production deployment. Для правок коду потрібна нова збірка.

### 2.1. Windows-докази 29.09.2026

Переглянуто всі вісім наданих користувачем скриншотів. Файли
`image(20260929-094311).png`, `image(20260929-094328).png`,
`image(20260929-094341).png`, `image(20260929-094351).png`,
`image(20260929-094405).png`, `image(20260929-094420).png`,
`image(20260929-094430).png`, `image(20260929-094441).png`
є вхідними доказами цієї фіксації; зображення не дублюються в git.

| Видимий доказ | Результат |
|---|---|
| Mocked Chromium suite | **152 passed (4.9m)**; серед видимих PASS — F5 preferences, scroll/collapse, permissions, security, performance |
| Підготовка demo | PostgreSQL/Mosquitto/backend/simulator **Healthy**; `DEMO seed already exists; data and passwords preserved` |
| Live browser suite | `Running 10 tests`, усі 10 позначені успішними; наступний cumulative gate завершений |
| Наскрізний MQTT scenario | Telemetry → rule event → alarm → notification → personal reads → owner ACK → recovery **PASS** |
| Build budget | 24 chunks; **266 392 / 358 400 bytes gzip**, largest **71 628 / 122 880 bytes** |
| npm audit | **found 0 vulnerabilities** для цього локального запуску |
| Фінальний wrapper | **PASS: stage 14.3–14.4 frontend test baseline. This is NOT a production release.** |
| Запуск frontend | Після PASS видно виклик `npm run start`; наступний рядок Ready і ручні дії в браузері не показані |

**Межі:** SHA локального checkout не показаний. Ці скриншоти підтверджують
локальний автоматичний прогін, але не встановлюють точну revision. Для
доповнення provenance зберегти `git rev-parse HEAD` і `git status --short`
до наступних локальних змін. Окремі Windows unit/repeat підсумки й performance
JSON не надані; 90 unit, 44 repeats та точні browser timings вище є доказами CI.
Непоказані ручні дії, zoom/screen reader та фізичне обладнання не позначаються PASS.
Старі 146 mocked Windows results залишаються історією 14.1–14.2.

## 3. Артефакти та відтворення

- `frontend-browser-report`: повний Playwright report, accessibility
  attachments, `performance-device.json`, `performance-navigation.json`,
  `artifacts/stage14/build-budget.json` і dependency audit JSON.
- `frontend-repeat-report`: окремий report фінального repeat-run;
  точні 44 результати — у log відповідних CI steps.
- `frontend-auth-live-report`: isolated live E2E report.

Фінальні artifact IDs: browser **11019200042**, repeats **11019065678**,
live **11018113658**. Всі прив’язані до run `36535454970` / `d51841d`.

Artifacts зберігаються GitHub **5 днів**; стійкі SHA, run/job links і
числа збережено нижче/в досьє. Після expiry звіти відтворюються запуском
workflow на потрібній revision. Локальний `npm run test:browser` створює
performance JSON у `frontend/test-results`, build budget — в `artifacts/stage14`.

## 4. Що ще потрібно випробувати

| Напрям | Наступний доказ |
|---|---|
| Provenance Windows | Wrapper 14.3–14.4 вже PASS; додати SHA з `git rev-parse HEAD` і стан checkout з `git status --short` |
| Ручний UX | Метрика/період/інтервал без стрибка до верху, F5 збереження, згортання деталей без порожньої області |
| Ролі/ізоляція | Owner/viewer, дві організації й вкладки; logout прибирає приватні дані; personal read не змінює чужий стан |
| Доступність | Реальний browser zoom 200/400%, keyboard/focus, screen reader; Chromium axe не означає повну WCAG відповідність |
| Реальний контролер | Окремий погоджений стенд: sensor mapping, telemetry quality, ACK/result, reconnect та аварії; simulator не доводить фізичну поведінку |
| Тривалі/навантажувальні тести | Реальна кількість пристроїв, browser session soak, API/DB/MQTT load, latency та memory trends |
| Deployment | Цільовий TLS/domain/cookies/CORS/CSP, secrets, monitoring, backup/restore і rollback |

Прийнятий frontend progress лишається **10/24** до явного закриття
ручних сценаріїв. Досьє фіксує реалізацію й перевірені факти,
а не замінює приймання або майбутнє рішення про production.
