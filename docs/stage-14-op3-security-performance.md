# Етап 14.3 — Безпека та продуктивність тестової бази

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата: **29.09.2026**. База змін: `a99c4f2`, backend **0.38.0**.
Разом із [14.4 — тестова база](stage-14-op4-test-baseline.md).
Підсумок усіх операцій — [досьє V3.5 Етапу 14](dossier-v3.5-stage-14-frontend-test-baseline.md).

## 1. Мета і знайдені ризики

Перед подальшими випробуваннями посилено browser security boundary і
додано відтворювані виміри. Це не незалежний security audit та не
підтвердження готовності до промислової експлуатації.

| Перевірений напрям | Результат |
|---|---|
| API destination | Раніше загальний helper приймав `//інший-host`. Поточні екрани цього не використовували, але helper міг винести credentialed request за межі API origin |
| Redirects | Fetch тепер відхиляє redirect; write не повторюється на іншій адресі |
| Browser content policy | Додано CSP з окремим nonce для кожного HTML response та захисні заголовки |
| Tenant/session cache | Збережено scope user/session/organization/device, cancellation, generation guards та очищення при logout; regression suite перевіряє late responses і дві вкладки |
| Escaping | React text output зберігається; тест перевіряє literal HTML у notification без створення DOM image |
| Storage | Access token залишається в пам'яті; browser тест перевіряє відсутність credential keys/token у localStorage/sessionStorage |
| Render cost | Прибрано створення Intl formatter для кожного timestamp/числа графіка |

## 2. Політика CSP

`frontend/src/proxy.ts` створює nonce, перезаписує вхідний CSP header і передає
політику Next.js через request та response. Root layout викликає
`await connection()`, тому framework/page scripts отримують nonce під час
динамічного рендерингу. HTML і RSC мають `private, no-store, max-age=0`;
immutable static assets лишаються кешованими.

| Директива / header | Політика |
|---|---|
| `script-src` | `'self'`, per-request nonce, `'strict-dynamic'`; production без `unsafe-inline` і `unsafe-eval` |
| `script-src-attr` | `'none'`; inline event handlers заборонено |
| `connect-src` | `'self'` та configured API origin; dev додатково HMR WebSocket origin |
| `style-src` | `'self' 'unsafe-inline'` — свідомий виняток для React grid widths/SVG styles |
| `object-src`, `base-uri`, `frame-src`, `frame-ancestors` | `'none'` |
| `form-action` | `'self'` |
| `img-src` / `font-src` | self/data/blob для images, self для fonts |
| `X-Content-Type-Options` / `X-Frame-Options` | `nosniff` / `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation вимкнено |

Development допускає `unsafe-eval` для Next.js. Браузерні перевірки працюють
через **`next start` після build**, тому перевіряють production-політику.
`strict-dynamic` довіряє залежностям, які завантажує вже дозволений script;
CSP не є sandbox для DevTools або скомпрометованого trusted JavaScript.
App code не будує script URLs/HTML із notification payload.
Nonce вимагає server rendering для кожного запиту: HTML не можна
використовувати як static export/ISR або кешувати на CDN. Це усвідомлена
вартість захисту для authenticated UI; server capacity ще потрібно виміряти.

HSTS та `upgrade-insecure-requests` не вмикаються для локального HTTP demo.
TLS, secure cookies, reverse proxy і CSP на цільовому домені належать до
окремих deployment-випробувань. API origin задається **до build**;
його зміна потребує нової збірки. CSP не замінює backend authorization,
CSRF, input validation або контроль доступу до обладнання.

## 3. API та formatter changes

`buildApiUrl` приймає лише root-relative path на configured backend origin.
Protocol-relative/absolute URLs, backslash, control/space та fragment
відхиляються до fetch і прикріплення credentials. `redirect: "error"`
доповнює `credentials: "include"` та `cache: "no-store"`.
Якщо proxy почне перенаправляти канонічний API URL, UI покаже transport
error; слід виправити конфігурацію endpoint, а не дозволяти redirect.

Date formatter cache обмежений **8 timezone-конфігураціями**. Він не містить
дат, tenant payload чи токенів. Number formatter графіка створюється один
раз. Unit regression перевіряє незмінність форматування UTC/Kyiv/New York,
null і fallback для невідомої timezone. Відсоток прискорення не заявляється.

## 4. Performance budgets і метод

| Показник | Gate | Метод і межі |
|---|---|---|
| Усі build JS chunks gzip | ≤ 384 000 bytes (375 KiB) | Сума окремо gzip-стиснених `.next/static/**/*.js`; не transfer однієї сторінки |
| Найбільший JS chunk gzip | ≤ 122 880 bytes (120 KiB) | Той самий Node/zlib звіт |
| Початкова панель | < 8 000 ms | Chromium, локальний production build, mocked API, до готового графіка |
| Щільна історія | < 4 000 ms | Зміна інтервалу до 672 заповнених buckets, очікування DOM і двох animation frames |
| Початкові API requests | ≤ 14 | Без OPTIONS, до готовності панелі; шляхи додаються до JSON |
| DOM nodes щільної історії | < 15 000 | Уся сторінка з 672 рядками, не лише SVG |
| Retained JS heap | < 96 MiB; приріст < 16 MiB | 2 warm-up + 6 циклів панель → аварії → панель, forced GC/CDP |

Це початкові regression gates для CI, а не SLO для клієнтського інтернету.
Не вимірюють backend throughput, WAN, full browser RSS чи тривалі memory
leaks. Не підтверджують роботу з 10 000 пристроїв. Baseline threshold має
змінюватися лише після поясненого виміру, а не для маскування падіння.

Звіт build містить revision, build ID, Node і dependencies. Browser reports
містять latency, request paths, DOM nodes, heap before/after та CSP/errors.
Актуальні виміри й CI provenance — у [14.4](stage-14-op4-test-baseline.md).

## 5. Додані перевірки

- 7 unit cases: 5 небезпечних API paths, правильний origin/fetch policy та date formatting.
- 4 browser cases: nonce/headers, блокування injected scripts/handlers,
  escaping/storage/logout-back, fail-closed redirect.
- 2 browser cases: request/render budgets і retained heap/navigation без CSP violations.
- `npm run check:budget` та CI `npm audit --json --audit-level=high`.

Audit snapshot включає dev dependencies; gate блокує high/critical або
помилку registry. Нуль відомих vulnerabilities на дату запуску не доводить
відсутність невідомих проблем. Залежності в цій операції не оновлювалися.

## 6. Первинні джерела реалізації

- [Next.js: CSP, nonces та dynamic rendering](https://nextjs.org/docs/app/guides/content-security-policy).
- [Playwright: CDPSession](https://playwright.dev/docs/api/class-cdpsession).
- [Chrome DevTools Protocol: Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/).

З 0.49.0 whole-build budget становить 375 KiB: додані окремі routes реєстрації,
запрошення й учасників збільшили суму gzip chunks приблизно на 20 KiB
(348 460 → 368 301 bytes на локальному build). Це сума всіх routes,
а не завантаження сторінки входу. Окремий chunk ceiling 120 KiB збережено.
