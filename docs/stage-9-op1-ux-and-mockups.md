# Етап 9, операція 1 — UX-сценарії та макети KERUMO

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата первинної підготовки: 27.09.2026. База: backend **0.38.0**, Етап H завершено 5/5.

**Статус: операцію 9.1 прийнято користувачем і закрито 27.09.2026.
Frontend roadmap: 1/24. Етап 9: 1/4. Наступна операція — 9.2.**

Production frontend, Next.js-проєкт і live API integration цією операцією не
створюються. Макет містить лише демонстраційні дані й не надсилає команд.

## 1. Причина ревізії

Перша версія була надмірно темною та контрастною: accent color, glow, великі
темні площини й різнокольорові status-картки одночасно конкурували за увагу.
Це погіршувало орієнтацію та створювало враження декоративного dashboard,
а не спокійного промислового робочого кабінету.

Ревізія 2 змінює напрямок на **light industrial SaaS**:

- світла нейтральна основа;
- білі робочі surface з тонкими межами;
- бірюзовий лише як brand/primary accent;
- semantic green/yellow/red лише для станів;
- одна чітка hierarchy замість однаково яскравих карток;
- керування фізичним обладнанням відокремлено від telemetry;
- контекст організації, об’єкта і Device завжди видимий.

## 2. Референси та висновки

Під час перегляду dashboard-підходів враховано не копіювання зовнішнього
бренду, а інформаційну архітектуру:

1. **Samsara Operations Overview** — короткий operational summary, фільтри,
   сортування та перехід від огляду до конкретного asset.
2. **Samsara Device Health** — централізований стан пристроїв, видимі причини
   проблем і конкретні recommended actions.
3. **Ubiquiti UniFi** — проста multi-site navigation, стримана surface system
   та однакова модель переходу від організації до site і device.
4. Загальні industrial/energy dashboards — status first, telemetry second,
   command surface окремо від read-only metrics.

Офіційні сторінки, використані як design research:

- https://kb.samsara.com/hc/en-us/articles/4402308140941-Operations-Overview
- https://kb.samsara.com/hc/en-us/articles/360043670172-Device-Health
- https://ui.com/introduction

Жоден зовнішній layout не відтворюється один в один. KERUMO зберігає власний
бренд, модульну device model і backend semantics.

## 3. Результат ревізії 2

Підготовлено:

- login screen;
- список пристроїв із summary та фільтрами;
- desktop і mobile Device dashboard;
- аварії та історію інцидентів;
- матрицю loading/empty/stale/offline/missing/invalid і command lifecycle;
- сценарії viewer/operator/owner;
- правила кольору, hierarchy, responsive та safe control;
- відтворюваний статичний preview.

Preview:

- [`frontend/mockups/stage9-1/index.html`](../frontend/mockups/stage9-1/index.html)
  — стабільна вхідна точка;
- [`frontend/mockups/stage9-1/revision2.html`](../frontend/mockups/stage9-1/revision2.html)
  — автономний preview ревізії 2;
- [`frontend/mockups/stage9-1/README.md`](../frontend/mockups/stage9-1/README.md)
  — локальний запуск.

`revision2.html` є автономним статичним preview для приймання. Читабельна
production-компонентна реалізація починається в 9.2 на Next.js/TypeScript;
цей файл не є майбутньою структурою застосунку.

## 4. Бренд і технічні межі

Зовнішня продуктова назва першого UI — **KERUMO**.

У межах 9.1 не перейменовуються:

- repository `STechbaza-iot`;
- Python packages та Docker service names;
- `techbaza/...` MQTT topics;
- tables, migrations, environment variables і fixtures.

Cosmetic rename не повинен змінювати прийнятий backend 0.38.0, MQTT contract
або backup/restore. Технічне перейменування, якщо воно знадобиться, виконується
окремою операцією з міграційним планом.

## 5. Мова й термінологія

Основна мова першої версії — українська. Технічні API codes залишаються
англійськими у DTO, але UI показує зрозумілі назви.

| Backend object | Назва в UI |
|---|---|
| Organization | Організація |
| Site | Об’єкт |
| Device | Пристрій / контролер |
| Capability assignment | Модуль / встановлена можливість |
| Telemetry reading | Показник |
| Alarm | Аварія або попередження |
| Event | Подія |
| Command | Команда |
| local mode | Локальний режим / панель |
| remote mode | Дистанційний режим |

## 6. Карта сторінок

```text
/login
  ↓
/app
  ├── /organizations
  ├── /organizations/{organizationId}/sites
  ├── /sites/{siteId}/devices
  ├── /devices/{deviceId}
  │     ├── overview
  │     ├── charts
  │     ├── commands
  │     ├── alarms
  │     └── events
  ├── /organizations/{organizationId}/notifications
  └── /profile/session
```

Desktop використовує постійну ліву navigation rail. Mobile використовує
компактний header і нижню navigation: Панель, Графіки, Аварії, Ще.

## 7. Головна hierarchy Device dashboard

Порядок відповідає задачам оператора:

1. **Контекст:** organization → site → device, назва й UID.
2. **Стан:** online/offline, remote/local mode, data freshness, active alarm.
3. **Ключові показники:** frequency, current, pressure, water level.
4. **Тренд:** один головний графік із явною metric, unit і періодом.
5. **Керування:** окрема control panel із причиною enabled/disabled.
6. **Проблеми:** активні аварії та recommended next action.
7. **Модулі:** лише enabled assignments поточного Device.
8. **Команда:** lifecycle останнього наміру й audit.

Таким чином read-only telemetry не змішується з критичними write-actions.

## 8. Модульність

Dashboard не має фіксованого набору cards для всіх клієнтів. Склад визначає
`overview.modules` і пов’язані `channels`, `readings`, `state_readings`,
`allowed_commands` та permissions.

| Capability / channel | UI |
|---|---|
| `vfd.frequency.read` | Частота, Hz, graph action |
| `vfd.current.read` | Струм, A, graph action |
| `pressure.read` | Тиск, bar, graph action |
| `water_level.read` | Рівень води, %, graph action |
| `vfd.state.read` | running/fault/local/emergency indicators |
| `vfd.control` | Start/Stop/frequency лише з allowed commands |
| unknown `supported=false` | нейтральний fallback без вигаданого control |

Вимкнений assignment зникає з UI. `false`, `0`, `missing` та `invalid` — різні
стани й ніколи не нормалізуються в одне значення.

## 9. Visual system ревізії 2

| Token | Значення preview |
|---|---|
| App background | `#F4F6F7` |
| Primary surface | `#FFFFFF` |
| Subtle surface | `#F8FAFA` |
| Border | `#DDE4E6` |
| Primary text | `#172126` |
| Secondary text | `#66757C` |
| Brand / action | `#147F79` |
| Success | `#2E7D5B` |
| Warning | `#A66A16` |
| Danger | `#B84245` |
| Radius | 10–14 px |
| Shadow | слабка, лише для layer separation |

Правила:

- no neon glow;
- no full-screen gradient;
- accent не використовується для кожної card;
- червоний зарезервовано для fault, danger і Stop;
- колір не є єдиним носієм status: є текст, icon і label;
- таблиці й cards мають більше whitespace, ніж декоративних елементів.

## 10. Стан зв’язку й даних

| Стан | Поведінка UI |
|---|---|
| Loading | skeleton, без даних попереднього Device |
| Empty | пояснення наступної дії |
| Online + fresh | нормальний live state |
| Online + stale | жовтий quality status, timestamp старого packet |
| Offline | червоний status, last seen, старі readings явно історичні |
| Missing | `—`, не 0 і не точка на графіку |
| Invalid | explicit invalid/type state, без висновку про pump state |
| Session change | новий heartbeat не робить старі readings fresh |
| Unsupported | code і neutral fallback, без generic command controls |

`online`, `fresh telemetry`, HTTP success, MQTT ACK і фізичний Result — різні
стани. UI не зводить їх до однієї зеленої позначки.

## 11. Command lifecycle

```text
queued → published → acknowledged → succeeded / failed
                                ↘ expired / result_unknown
```

- ACK означає отримання envelope контролером, а не фізичне виконання;
- succeeded показується лише після final Result;
- фактичний стан насоса підтверджує нова telemetry/state;
- result_unknown не запускає автоматично новий Start;
- double click створює один intent і один `request_id`;
- write не повторюється автоматично після невідомої network response.

## 12. Безпека керування

1. Start і зміна frequency мають confirmation dialog.
2. Control panel завжди показує local/remote mode окремо від online.
3. У local mode remote controls disabled із видимою причиною.
4. Viewer не бачить enabled controls; backend залишається остаточним guard.
5. Stop не називається emergency stop і не підміняє фізичний safety circuit.
6. Frequency range не вигадується UI; limits мають прийти з конфігурації.

## 13. Responsive і accessibility

- desktop: постійна navigation та task-based two-column workspace;
- tablet: compact navigation, metrics у дві колонки;
- mobile: одна пріоритетна колонка, control після overview/metrics;
- touch targets приблизно 44 px;
- visible keyboard focus;
- dialogs повертають focus до trigger;
- semantic headings;
- status не передається лише кольором;
- polling не повинен безперервно оголошувати всі readings screen reader.

## 14. Що не входить у 9.1

- Next.js, React components і package lock;
- live browser login;
- OpenAPI type generation;
- TanStack Query;
- B2B invitation/QR claim/billing;
- alarm rule editor;
- OTA, camera або native app;
- firmware і physical interlocks.

## 15. Критерії приймання

У корені repository:

```powershell
python -m http.server 3000 --directory .\frontend\mockups\stage9-1
```

Відкрити `http://127.0.0.1:3000/#device` і перевірити desktop/mobile,
а також Вхід, Пристрої, Панель, Аварії та Стани.

Операція 9.1 мала закриватися після підтвердження:

1. спокійна light visual system прийнятна;
2. navigation і поточний context зрозумілі без пояснення;
3. desktop/mobile priority однакова;
4. modules відрізняються між Device;
5. online/fresh/stale/offline не змішані;
6. control відокремлено від telemetry;
7. ACK не показаний як фізичний Result;
8. українська термінологія погоджена.

## 16. Підтверджене користувацьке приймання — 27.09.2026

Користувач переглянув ревізію 2 і підтвердив, що поточний зовнішній вигляд
інтерфейсу є прийнятним. Окремо перевірено запитання про професійність кольорів,
розташування та коду.

Підсумок приймання:

- палітра стримана, семантичні кольори не конкурують із контентом;
- hierarchy та порядок блоків відповідають задачам оператора;
- navigation, organization/site/device context і mobile priority зрозумілі;
- telemetry, стани та критичні controls розділені;
- модульність і command lifecycle не спрощені до оманливого «все працює»;
- статичний код придатний як відтворюваний артефакт UX-приймання 9.1.

Важлива межа: автономний HTML preview не оголошується production-кодом.
Його compressed/minified структура допустима лише для однофайлового перегляду.
Професійна підтримувана реалізація з TypeScript, React-компонентами, design
tokens, accessibility, lint/typecheck і тестами є предметом операції 9.2.
Ця межа не блокує закриття 9.1, тому що її scope — сценарії, інформаційна
архітектура, visual direction, desktop/mobile макети та стани.

**Операцію 9.1 закрито. Етап 9: 1/4. Frontend roadmap: 1/24.**

Наступний крок — **9.2: Next.js/TypeScript strict, design system, navigation
shell і базові компоненти**.
