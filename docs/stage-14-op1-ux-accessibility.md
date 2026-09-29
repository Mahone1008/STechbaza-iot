# Етап 14.1 — UX та доступність основних екранів KERUMO

Дата: 29.09.2026. База: `147a10d`, [досьє Етапу 13](dossier-v3.5-stage-13-alarms-notifications.md).
Разом із [14.2 — browser regression](stage-14-op2-browser-regression.md).
Реалізовано; фінальний CI на `19bb2fd` — PASS: types/lint, 83 unit,
146 mocked, 10 live, 44 повтори та production build.
Windows 29.09.2026: 146 mocked / 10 live / cumulative gate PASS;
ручне приймання часткове, повні докази — у 14.2.

## Знайдені проблеми та зміни

| Проблема | Виправлення |
|---|---|
| Mobile CSS приховував третю й четверту колонки всіх DataTable | Усі колонки збережено; горизонтальний scroll усередині таблиці, region із назвою та tabIndex=0 |
| М’який текст, warning, active navigation та success badge мали недостатній контраст | Затемнено text-secondary/text-soft/brand/success/warning, посилено межі полів і placeholder |
| Focus залежав від слабкої напівпрозорої тіні | Спільний видимий outline для keyboard, summary і scroll regions; системний Highlight у forced-colors |
| Account menu не переводило фокус у menuitem | Enter/Space та ArrowUp/Down відкривають меню з фокусом; Escape повертає trigger; Tab/blur закриває меню |
| Skip link не мав явно фокусованого target | main отримав tabIndex=-1 |
| Компактний логотип мав aria-label на generic span | Семантичний role=img із назвою KERUMO |
| Native dialog допускав вихід Tab у browser chrome | Явне замикання Tab/Shift+Tab між доступними елементами, native inert/Escape/return focus збережені |
| Рядки розкриття details мали замалу область натискання на mobile/tablet | summary має мінімальну висоту 44 px і вертикальні відступи; native marker і keyboard behavior збережені |
| Напівпрозоре тло mobile navigation залежало від вмісту під панеллю | Суцільне surface тло для стабільного контрасту |
| Device detail не позначав активний mobile route | Спільне правило вкладених routes та aria-current=page |
| Заголовки й pagination потребували перенесення на вузькому екрані | Wrap для card headers, actions і pagination; mobile labels можуть переноситися |
| Закріплені панелі займали значну частину низького вікна | До 480 CSS px висоти topbar/mobile navigation переходять у звичайний потік |
| Min/max на графіку були блідими | Суцільні контрастні range lines; partial points використовують warning token |

Бренд, права, API та семантика read/ACK/команд збережені. Таблиці можуть
прокручуватися горизонтально як двовимірні дані; сторінка загалом має
вміщуватися в ширину. Таблиця вимірювань залишається текстовою альтернативою
графіка. Немає нових backend endpoints або migrations.

## Перевірки доступності

Додано dev-only `@axe-core/playwright` 4.13.0 із lockfile. У production bundle
цей test import не використовується. Scans використовують WCAG tags
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, без виключення
елементів або вимкнення правил. JSON reports прикріплюються до тестів,
включно з `incomplete`, які потребують ручного розгляду.

10 нових browser tests охоплюють:

- 7 workspace routes на desktop 1440×1000, tablet 768×1024 і mobile 320×640;
- login validation, field errors та keyboard focus;
- skip link, account menu й Escape/Tab на desktop/mobile;
- modal focus containment, Escape, повернення trigger без ACK;
- усі колонки таблиці та keyboard horizontal scroll;
- reflow 320×256 CSS px — еквівалент доступного простору 1280×1024 при 400%;
- empty/403 notification states без старих rows;
- screenshots notification/device detail на трьох ширинах, menu та confirmation.

Це Chromium coverage основних станів. Емуляція розміру viewport не є
натисканням browser zoom, перевіркою ОС scaling чи screen reader.
Автоматичний scan не підтверджує повної відповідності WCAG 2.2 AA.

## Результат axe та візуальний перегляд

Код [`19bb2fd`](https://github.com/Mahone1008/STechbaza-iot/commit/19bb2fd152a8930ec86d5fed1fba46783c841bb3),
[frontend job](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/job/109272402093):
146 browser tests PASS, зокрема всі 10 accessibility tests. **27 axe scans,
0 violations; 8 scan/rule pairs залишили `incomplete`**. Правила не вимкнено,
ці записи не приховано та не зараховано як автоматичний PASS відповідних критеріїв.

| `incomplete` | Розгляд |
|---|---|
| SVG contrast: чотири labels на кожній із трьох ширин | axe не визначив фон/короткі числові підписи. За CSS brand `#126f69` на surface `#ffffff` = 5.994:1; screenshots переглянуто. На 320 px підписи компактні; точні значення доступні в «Таблиця вимірювань», реальний zoom/AT лишається ручним |
| Mobile notification label: три screens на 320 px | axe повідомив часткове перекриття. Screenshot показує перенесення назви у два рядки; secondary `#586971` на суцільному білому тлі = 5.716:1. Поведінку під час прокрутки/zoom треба прийняти вручну |
| Menu aria-controls: desktop і mobile | Додаткова browser assertion підтверджує, що controls посилається на ID видимого menu; keyboard/Escape/Tab PASS |
| Confirmation description contrast | Screenshot не показує перекриття тексту; secondary/surface = 5.716:1. Focus containment та Escape перевірено окремим тестом |

Переглянуто всі 9 screenshots: device/notification на трьох ширинах,
два menu й confirmation. Це перегляд фіксованих станів, не ручна Windows
або screen-reader сесія. JSON і screenshots збережені в
[`frontend-browser-report`](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36527087657/artifacts/11015700057),
retention 5 днів; висновки зафіксовано тут, щоб не залежати від строку artifact.

## Джерела критеріїв

- [W3C: contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): звичайний текст 4.5:1, великий 3:1, з визначеними стандартом винятками.
- [W3C: non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): візуальна ідентифікація controls та значущої графіки.
- [W3C: reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): вузький viewport і винятки для двовимірного вмісту.
- [W3C APG: menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): keyboard/focus interaction.
- [Playwright: accessibility testing](https://playwright.dev/docs/accessibility-testing): axe scans доповнюють ручне оцінювання.

## Межі ручного приймання

Windows-команда і фінальний CI — у [14.2](stage-14-op2-browser-regression.md).
29.09.2026 користувач підтвердив Windows automated gate скриншотами;
на двох UI screenshots показано графіки частоти/тиску й видимий focus outline.
Окремо потрібні реальний browser zoom 200/400%, Tab/Shift+Tab, forced colors,
екранна клавіатура, screen reader, довгі назви й дані користувача та перевірка
того, що фокус не перекритий панелями. Інші browser engines тут не заявляються.
Прийнятий progress 10/24 не збільшується від самого додавання автотестів.

Актуальна наступна база: [14.3](stage-14-op3-security-performance.md),
[14.4](stage-14-op4-test-baseline.md) та [загальне досьє V3.5 Етапу 14](dossier-v3.5-stage-14-frontend-test-baseline.md).
На прохання користувача це базова версія для випробувань, не production-реліз.
