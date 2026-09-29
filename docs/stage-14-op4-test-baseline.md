# Етап 14.4 — Тестова база frontend і досьє

Дата: **29.09.2026**. Разом із [14.3 — security/performance](stage-14-op3-security-performance.md).

**За уточненням користувача це базова версія перед подальшими тестами,
не production-реліз.** `npm run build` означає технічний спосіб збірки;
він не є рішенням про введення в експлуатацію. Release/tag/deployment
у цій операції не створюються. Загальне [досьє V3.5 Етапу 14](dossier-v3.5-stage-14-frontend-test-baseline.md).

## 1. Перевірки та provenance

<!-- STAGE14_FINAL_EVIDENCE -->
Локально: **90 unit / typecheck / lint / production build / bundle budget — PASS**.
Зареєстровано **152 mocked browser tests у 17 файлах**. Повний CI ще
очікується; цей запис буде замінено фактичними результатами після запуску.
HTTP-перевірка зібраного `/login`: 200, новий nonce для другого запиту,
усі 13 script tags мають nonce, `no-store`, немає `X-Powered-By`.
Локальний npm audit: **0 vulnerabilities**. Локальний build JS gzip:
266 392 bytes сумарно, 71 628 bytes найбільший chunk (24 chunks).
Цей локальний build був до коміту; revision у його JSON ще вказує на базу.
<!-- /STAGE14_FINAL_EVIDENCE -->

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
Повний suite запускається знову після виправлення test setup.

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

Новий Windows-прогін 14.3–14.4 ще не підтверджений користувачем. Попередні
скриншоти з **146 mocked / 10 live / gate PASS** належать до 14.1–14.2;
їх не перенесено на нові зміни. У локальному середовищі агента немає
робочого Chromium/Docker; повні browser/live докази беруться з CI.

## 3. Артефакти та відтворення

- `frontend-browser-report`: повний Playwright report, accessibility
  attachments, `performance-device.json`, `performance-navigation.json`,
  `artifacts/stage14/build-budget.json` і dependency audit JSON.
- `frontend-repeat-report`: окремий report фінального repeat-run;
  точні 44 результати — у log відповідних CI steps.
- `frontend-auth-live-report`: isolated live E2E report.

Artifacts зберігаються GitHub **5 днів**; стійкі SHA, run/job links і
числа збережено нижче/в досьє. Після expiry звіти відтворюються запуском
workflow на потрібній revision. Локальний `npm run test:browser` створює
performance JSON у `frontend/test-results`, build budget — в `artifacts/stage14`.

## 4. Що ще потрібно випробувати

| Напрям | Наступний доказ |
|---|---|
| Windows на новій revision | Фінальний PASS wrapper 14.3–14.4 і SHA з `git rev-parse --short HEAD` |
| Ручний UX | Метрика/період/інтервал без стрибка до верху, F5 збереження, згортання деталей без порожньої області |
| Ролі/ізоляція | Owner/viewer, дві організації й вкладки; logout прибирає приватні дані; personal read не змінює чужий стан |
| Доступність | Реальний browser zoom 200/400%, keyboard/focus, screen reader; Chromium axe не означає повну WCAG відповідність |
| Реальний контролер | Окремий погоджений стенд: sensor mapping, telemetry quality, ACK/result, reconnect та аварії; simulator не доводить фізичну поведінку |
| Тривалі/навантажувальні тести | Реальна кількість пристроїв, browser session soak, API/DB/MQTT load, latency та memory trends |
| Deployment | Цільовий TLS/domain/cookies/CORS/CSP, secrets, monitoring, backup/restore і rollback |

Прийнятий frontend progress лишається **10/24** до явного закриття
ручних сценаріїв. Досьє фіксує реалізацію й перевірені факти,
а не замінює приймання або майбутнє рішення про production.
