# Досьє V3.5 — Етап 14

## Якість, безпека, продуктивність і тестова база frontend KERUMO

Дата: **29.09.2026**. Backend: **0.38.0 / 47 paths / 17 migrations**.

**Реалізовано 14.1–14.4 як базову версію для подальших випробувань.**
Фінальний CI: **90 unit / 152 mocked / 10 live + 44 repeat — PASS**;
npm audit **0 vulnerabilities**. Windows 29.09.2026:
**152 mocked / 10 live / фінальний gate 14.3–14.4 PASS**;
SHA локального checkout не показаний, ручне приймання лишається відкритим.
На прохання користувача колишній пункт «release/dossier» уточнено як
«тестова база / досьє». Промисловий реліз, deploy чи release tag не робилися.
Прийнятий frontend roadmap лишається **10/24**: реалізація всіх операцій
не закриває попередні ручні перевірки.

## 1. Результат чотирьох операцій

| Операція | Реалізація | Межі приймання |
|---|---|---|
| [14.1 — UX/accessibility](stage-14-op1-ux-accessibility.md) | Контраст, видимий focus, keyboard menu/dialog, mobile tables, short viewport reflow, axe scans | CI та попередній Windows PASS; реальний zoom/assistive technology потребують ручної перевірки |
| [14.2 — Browser regression](stage-14-op2-browser-regression.md) | Owner/viewer journeys, дві організації/вкладки, login → history → alarm → read → logout, live cross-tab logout | Попередні 146 mocked / 10 live Windows PASS; manual acceptance часткове |
| [14.3 — Security/performance](stage-14-op3-security-performance.md) | CSP/nonce/headers, API origin і redirect guard, escaping/storage tests, formatter reuse, bundle/request/render/heap gates | Автотести та виміри в 14.4; не security certification і не навантажувальна атестація |
| [14.4 — Тестова база](stage-14-op4-test-baseline.md) | Відтворювана production-mode збірка, CI/live evidence, Windows wrapper, це досьє та залишок випробувань | Windows gate PASS за скриншотами; SHA checkout, ручні/апаратні випробування відкриті |

## 2. Виправлення та інженерні рішення

14.1 виправив слабкий контраст, видимість focus, керування account menu
та confirmation з клавіатури, семантику logo і приховані mobile columns.
Таблиці прокручуються всередині області, summary має доступну ціль,
вузький/низький viewport зберігає дії. 14.2 додав наскрізні user journeys
та regression checks із двома tenants/tabs. Детальна історія невдалих
і виправлених CI збережена в операційних документах.

14.3 закрив latent gap у загальному API helper: path виду `//host`
більше не може змінити origin запиту з credentials. Fetch не переходить
за redirect. У поточних екранах експлуатацію цього gap не виявлено.
Захисні заголовки й nonce CSP блокують довільні inline scripts/handlers,
framing і сторонні connections поза configured origin. Backend лишається
авторитетним для permissions/tenant access.

HTML динамічний і не кешується; кожен response має власний nonce.
Inline styles залишено для чинних React/SVG styles. Це обмежений
виняток CSP, задокументований у 14.3. TLS/HSTS для робочого домену
перевірятимуться окремо. Formatter cache містить лише максимум
8 timezone-конфігурацій; приватні дані не кешує.

## 3. Перевірки й точні revisions

Попередня завершена база 14.1–14.2:

- Code [`19bb2fd`](https://github.com/Mahone1008/STechbaza-iot/commit/19bb2fd152a8930ec86d5fed1fba46783c841bb3).
- [CI 36527087657](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657):
  **83 unit / 146 mocked / 10 live + 44 repeat — PASS**, без retries.
- **27 axe scans / 0 violations**, 8 incomplete scan/rule pairs розглянуто
  окремо; 9 screenshots переглянуто. Це не повна WCAG-сертифікація.
- Windows 29.09.2026: **146 mocked / 10 live / cumulative gate PASS**;
  показані графіки частоти/тиску й focus outline. SHA зі скриншотів не
  встановлюється; непоказані manual actions не вважаються підтвердженими.
- Documentation/Windows evidence: `f5248c5`, `a99c4f2`.

Фінальна нова база 14.3–14.4:

- Реалізація [`aea94d9`](https://github.com/Mahone1008/STechbaza-iot/commit/aea94d903c6bf0cb4217c1f9af378a06e3443645),
  фінальна перевірена revision [`d51841d`](https://github.com/Mahone1008/STechbaza-iot/commit/d51841d848d0bb66eec9cb9dbd09d2b94c5a2e13).
- [CI 36535454970](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36535454970):
  **90 unit / 152 mocked / 10 live + 44 repeat — PASS**, browser retries 0.
  OpenAPI zero diff, types/lint/build/budget/audit — PASS.
- **27 axe scans / 0 violations**, 8 incomplete scan/rule pairs лишаються
  предметом ручної оцінки. Переглянуто свіжі desktop/mobile/device/dialog screenshots.
- npm audit: **0 known vulnerabilities**, включно з dev dependencies.
- Performance baseline: **266 392 bytes gzip** (24 JS chunks), largest
  **71 628 bytes**; панель **1 546 ms**, 672 buckets **443 ms**, **9 requests**,
  **9 748 DOM nodes**; heap **6 126 176 → 6 684 840 bytes** після 6 measured cycles,
  приріст **558 664 bytes**, page errors/CSP violations **0/0**.
- Повна [таблиця перевірок, job links і Windows-команда](stage-14-op4-test-baseline.md)
  та стійкий [JSON evidence snapshot](evidence/stage-14-baseline-2026-09-29.json).
- Перший CI `36534512798`: 150 pass / 2 fail у нових tests; виправлено
  модель HTML injection та setup browser history. Повторний повний CI зелений;
  опис причин збережено в 14.4. Production CSP/budgets не послаблювали.
- Windows 29.09.2026, вісім скриншотів `094311`–`094441`:
  **152 mocked passed за 4.9 min**, усі **10 live** позначені успішними,
  MQTT → alarm → notification → reads → ACK → recovery PASS,
  фінальний **14.3–14.4 gate PASS**. Bundle: **266 392 / 358 400 bytes gzip**,
  24 chunks, largest **71 628 / 122 880 bytes**; npm audit **0 vulnerabilities**.
  PostgreSQL/Mosquitto/backend/simulator — Healthy; demo seed збережено.
  SHA Windows checkout, точні Windows performance JSON, окремий unit summary
  і repeat-run на цих скриншотах відсутні; числа CI не переносимо на Windows.
  Детальна [фіксація доказів і меж](stage-14-op4-test-baseline.md#21-windows-докази-29092026).

Backend source/schema у 14.3–14.4 не змінювався. Frontend CI не є новим
повним backend unit/integration або hardware test run.

## 4. Що означають performance numbers

Bundle gate вимірює суму всіх незалежно gzip-стиснених JS chunks,
не перше завантаження однієї сторінки. Browser baseline використовує
production build і mocked API. Вимірюються готовність графіка, 672
заповнені buckets, число API calls, DOM nodes та heap після repeated
client navigation з forced GC. Звіти містять фактичні значення й budgets.

Ні ці числа, ні 10 live E2E не доводять масштабування до 10 000 пристроїв,
польову latency, довготривалу стабільність чи фізичний результат команди.
Потрібні окремі backend/MQTT/load, soak та controller bench тести.

## 5. Запуск та наступна точка роботи

Єдина актуальна [Windows-команда і таблиця приймання](stage-14-op4-test-baseline.md#2-windows-одна-команда)
використовує `scripts/check-stage14-op3-op4.ps1 -Start`.
Наявні demo credentials/volumes зберігаються. Після PASS відкривається
локальна зібрана версія на `http://127.0.0.1:3000/login`.

Послідовність подальшої роботи:

1. Windows gate 14.3–14.4 підтверджений; додати SHA checkout і пройти залишок ручних сценаріїв 11–14:
   scroll/F5/collapse, owner/viewer, tenants/tabs, keyboard/zoom/screen reader.
2. На окремому погодженому стенді перевірити фізичний контролер,
   sensor mapping, ACK/result, втрату зв'язку та аварії.
3. Провести тривалі й навантажувальні тести з репрезентативними даними.
4. Перевірити цільове розгортання, TLS/cookies/CORS/CSP, monitoring,
   backup/restore та rollback; лише потім окремо вирішувати про production.

Наступні номери етапів не вигадуються: план 9–14 реалізований,
відкритий пункт — випробування й приймання базової версії.

29.09.2026 на наступний запит користувача підготовлено окремий
[план готовності всього продукту P0–P9](product-readiness-plan-v1.md):
PostgreSQL, firmware, identity/MQTT/LTE, deployment, OTA, hardware і пілот.
Це майбутній план з власними ID; він не змінює наведені результати й приймання.

## 6. Навігація

- [Frontend roadmap 9–14](frontend-roadmap-v1.md).
- [14.1](stage-14-op1-ux-accessibility.md), [14.2](stage-14-op2-browser-regression.md),
  [14.3](stage-14-op3-security-performance.md), [14.4](stage-14-op4-test-baseline.md).
- [Досьє Етапу 13](dossier-v3.5-stage-13-alarms-notifications.md).
- [Frontend README](../frontend/README.md).
