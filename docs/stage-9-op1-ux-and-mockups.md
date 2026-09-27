# Етап 9, операція 1 — сценарії, карта сторінок і макети KERUMO

Дата підготовки: 27.09.2026. База: backend **0.38.0**, Етап H завершено 5/5.

**Статус: результат підготовлено та передано на приймання користувачу. Операція
9.1 ще не закрита; загальний лічильник frontend залишається 0/24 до явного
підтвердження.** Production frontend, Next.js-проєкт і підключення до API цією
операцією не створюються.

## 1. Результат операції

Підготовлено:

- зовнішню продуктову назву та правила співіснування бренду KERUMO з чинними
  технічними ідентифікаторами TechBaza;
- карту сторінок першого web UI;
- сценарії owner/operator/viewer;
- desktop і mobile макети;
- правила модульної побудови панелі за `modules`, `channels`, `readings`,
  `state_readings`, `allowed_commands` і permissions backend;
- таблицю loading/empty/offline/stale/missing/invalid та command lifecycle;
- правила безпечного відображення керування насосом;
- статичний інтерактивний прототип без live API й без реальних команд.

Інтерактивний макет:
[`frontend/mockups/stage9-1/index.html`](../frontend/mockups/stage9-1/index.html).
Інструкція запуску:
[`frontend/mockups/stage9-1/README.md`](../frontend/mockups/stage9-1/README.md).

## 2. Бренд і межа перейменування

### Зовнішня назва

Перший користувацький інтерфейс оформлюється як **KERUMO**. Назва показується
на login, у navigation shell, у title/meta, на сторінках пристроїв і в
користувацьких повідомленнях.

Робочий підзаголовок макета: **Industrial IoT control**. Це не остаточний
юридичний слоган і не реєстрація торговельної марки.

### Внутрішні ідентифікатори

У межах 9.1 не перейменовуються:

- репозиторій `STechbaza-iot`;
- Python packages та Docker service names;
- `techbaza/...` MQTT topics;
- `techbaza-backend` service identifier;
- чинні таблиці, migrations, environment variables та тестові fixtures.

Причина: cosmetic rename не повинен змінювати прийнятий backend 0.38.0 або
створювати ризик для MQTT, backup/restore і тестів. Технічне перейменування,
якщо воно буде потрібне, виконується окремою операцією з міграційним планом.

## 3. Мова та термінологія

Основна мова першої версії — **українська**. Технічні коди API, command status,
metric keys і capability codes не перекладаються в даних, але UI показує для
них зрозумілі українські назви.

| Технічний об'єкт | Назва в UI |
|---|---|
| Organization | Організація |
| Site | Об'єкт |
| Device | Пристрій / контролер |
| Capability assignment | Встановлена можливість / модуль |
| Telemetry reading | Показник |
| Alarm | Аварія або попередження залежно від severity |
| Event | Подія |
| Command | Команда |
| Acknowledge alarm | Підтвердити отримання аварії |
| Notification read | Позначити повідомлення прочитаним |
| local mode | Панель / локальний режим |
| remote mode | Дистанційний режим |

У майбутньому тексти мають бути винесені в i18n resource layer, але 9.1 не
додає бібліотеку локалізації до відсутнього Next.js-проєкту.

## 4. Ролі та основні сценарії

### Viewer

1. Входить у кабінет.
2. Бачить лише доступні організації, об'єкти та пристрої.
3. Переглядає online/offline, свіжість, показники, графіки, аварії та історію.
4. Не отримує активних Start/Stop/frequency controls.
5. Спроба ручного POST поза UI все одно блокується backend 403.

### Operator

1. Виконує всі read-сценарії viewer.
2. Бачить controls тільки з `allowed_commands` поточного Device.
3. Перед Start і зміною частоти бачить confirmation із назвою пристрою,
   режимом та значенням.
4. Після POST бачить lifecycle команди, а не миттєве «насос запущено».
5. Може acknowledge аварію за наявності permission; acknowledge не закриває
   фізичну причину.

### Owner / адміністратор організації

1. Має operator workflow.
2. Керує membership і capability assignments лише через існуючі дозволені API.
3. У першому UI не отримує декоративного B2B onboarding, QR claim або billing,
   оскільки backend цих vertical features ще не має.

### Superadmin / service role

Потрібні окремі сервісні екрани в майбутньому. Перший release не повинен
змішувати global diagnostics із звичайним клієнтським navigation shell.

## 5. Карта сторінок

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

Для mobile основні вкладки сторінки Device: **Панель**, **Графіки**,
**Аварії**, **Ще**. Desktop використовує постійну ліву navigation rail.

## 6. Екрани першої версії

| Екран | Основні дані | Критична поведінка |
|---|---|---|
| Login | Browser login, session errors, rate limit | Refresh cookie не читається JS; password не зберігається |
| Організації та об'єкти | `/organizations`, access, sites | Чужий URL не надає доступ; context switch очищає tenant cache |
| Пристрої | devices + bounded availability | Не опитувати overview всього парку; online не означає fresh |
| Панель Device | overview modules/readings/state/permissions | Склад віджетів лише з backend contract |
| Графік | series endpoint | Missing — gap; zero — значення; units і timezone явні |
| Керування | allowed commands, create/get command | Один `request_id` на намір; ACK ≠ Result |
| Команди | lifecycle і audit | Unknown не запускає автоматичний повтор Start |
| Аварії | incidents/transitions/acknowledge | Acknowledge ≠ resolved |
| Повідомлення | organization feed/read | Read персональне; не замінює acknowledge |

## 7. Структура панелі пристрою

Панель не має фіксованого набору карток для всіх клієнтів. Вона будується з
`overview.modules`.

### Постійний каркас

- назва, UID і об'єкт;
- availability;
- telemetry freshness;
- час генерації та час останнього достовірного packet;
- режим `local_mode`, якщо канал підтримується;
- область помилок доступу/мережі.

### Динамічні віджети

| Capability / channel | Віджет |
|---|---|
| `vfd.frequency.read` | Частота, unit Hz, series action |
| `vfd.current.read` | Струм, unit A, series action |
| `pressure.read` | Тиск, unit bar, series action |
| `water_level.read` | Рівень води, unit %, series action |
| `vfd.state.read` | Running/fault/local/emergency typed indicators |
| `vfd.control` | Start/Stop/frequency лише з `allowed_commands` |
| unknown supported=false | Нейтральний fallback без вигаданих даних або controls |

Вимкнений assignment зникає з modules і UI. Історичний snapshot не повинен
повертати його віджет. `missing`, `invalid`, `false` і `0` відображаються як
різні стани відповідно до backend contract.

## 8. Семантика станів

### Дані та зв'язок

| Стан | UI-поведінка |
|---|---|
| Loading | Skeleton; не показувати дані попереднього Device |
| Empty | Пояснення наступної дії, не порожня сторінка |
| Online + fresh | Нормальні live indicators |
| Online + stale | Жовта якість даних; не підміняти старе значення свіжим |
| Offline | Червоний статус, timestamp останнього зв'язку, старі дані з часом |
| Missing | `—`, без нуля та без точки на графіку |
| Invalid | Явний invalid/type state; не робити висновок про насос |
| Session change | Старі readings не стають fresh від нового heartbeat |
| Unsupported module | Fallback і код модуля; без generic controls |

### HTTP і права

| Відповідь | Дія UI |
|---|---|
| 401 | Один координований refresh; після невдачі — login |
| 403 | Закрити ресурс/дію, оновити access, очистити заборонений cache |
| 404 | Не розкривати існування чужого ресурсу; показати недоступність |
| 409 | Конфлікт стану/capability; оновити overview, не повторювати write автоматично |
| 422 | Показати validation біля поля без технічного traceback |
| 429 | Врахувати `Retry-After`; не створювати storm |
| 5xx/network | Зберегти останній відомий стан із ознакою втрати зв'язку |

### Команди

```text
queued → published → acknowledged → succeeded / failed
                                ↘ expired / result_unknown
```

- `queued`: backend створив запис;
- `published`: була спроба MQTT publish;
- `acknowledged`: контролер прийняв envelope;
- `succeeded`: отриманий фінальний успішний Result;
- `failed`: контролер повернув невиконання;
- `expired`: TTL закінчився;
- `result_unknown`: ACK був, але остаточного Result немає.

Жоден проміжний status не використовується як доказ фактичного стану насоса.
Фактичний стан береться з нової telemetry/state після виконання.

## 9. Безпека керування

1. Start і зміна частоти мають confirmation dialog.
2. Stop не ховається лише через fault, але network Stop не називається
   аварійним фізичним відключенням.
3. UI показує `local_mode`/remote mode окремо від online.
4. При local mode controls disabled із чіткою причиною.
5. Подвійний click створює один намір і один `request_id`.
6. Write не повторюється автоматично після невідомої мережевої відповіді.
7. Viewer не бачить enabled controls; backend залишається остаточним guard.
8. Частотний діапазон UI не вигадується: межі повинні прийти з майбутньої
   конфігурації установки або бути погоджені окремо.

## 10. Visual system

Основний образ: промисловий, стриманий, дорогий, без «ігрової» неоновості.

| Token | Значення макета |
|---|---|
| Background | `#080F14` |
| Surface | `#111C24` / `#15232C` |
| Accent | `#16C2BD` |
| Success | `#6EDB83` |
| Warning | `#F5BD58` |
| Danger | `#FF6B70` |
| Text | `#F4F8FA` |
| Muted | `#8EA0AA` |
| Radius | 12–18 px |

Колір ніколи не є єдиним носієм status: використовуються текст, icon і форма.
Червоний зарезервовано для небезпеки, failed/fault і Stop action.

## 11. Responsive і accessibility

- desktop navigation: від 1024 px;
- tablet: compact navigation і двоколонкова dashboard grid;
- mobile: від 820 px, bottom navigation і одна основна action column;
- control targets не менші приблизно 40–44 px;
- focus states мають бути видимими з клавіатури;
- dialogs повертають focus до кнопки-виклику;
- heading hierarchy не залежить від розміру шрифту;
- live polling не повинен постійно оголошувати screen reader кожне значення;
- `prefers-reduced-motion` враховується під час production implementation;
- контраст перевіряється в 14.1, але правила закладаються з 9.2.

## 12. Макети

Tracked інтерактивний макет розміщено у
[`frontend/mockups/stage9-1/index.html`](../frontend/mockups/stage9-1/index.html).
Він містить п’ять перемикних представлень:

- login;
- парк пристроїв;
- desktop/mobile Device dashboard;
- аварії та події;
- матрицю loading/empty/offline/stale/missing/invalid і command lifecycle.

Макет побудований лише на HTML/CSS/JS, відкривається локально без залежностей
і не завантажує зовнішні ресурси. Дані демонстраційні й не є доказом
реалізованого API adapter або фізичного VFD control. Контрольні знімки екрана
формуються під час локального приймання, але не дублюються у Git як бінарні
артефакти: джерелом макета залишається відтворюваний tracked source.

## 13. Що не входить у 9.1

- package.json, Next.js або React components;
- browser login проти demo API;
- OpenAPI type generation;
- TanStack Query;
- production logo files і trademark package;
- B2B invitations, QR claim, payments;
- rule editor;
- OTA, camera або native mobile app;
- реальна firmware і hardware interlocks.

Це почнеться з операції 9.2 або окремих майбутніх vertical features.

## 14. Приймання користувачем

У корені локального репозиторію:

```powershell
Start-Process .\frontend\mockups\stage9-1\index.html
```

Перевірити перемикачі **Вхід / Пристрої / Панель / Аварії / Стани UI**, а також
зменшити ширину браузера до mobile.

Операція 9.1 закривається після підтвердження:

1. бренд KERUMO і палітра прийнятні;
2. карта сторінок зрозуміла;
3. desktop/mobile layout погоджені;
4. модулі відрізняються між Device;
5. online/fresh/stale/offline не змішані;
6. command ACK не показаний як фізичне виконання;
7. терміни та основна українська мова погоджені.

Після приймання наступна операція — **9.2: Next.js/TypeScript strict, design
system, navigation shell і базові компоненти**. 9.2 не закривається автоматично
разом із цим документом.
