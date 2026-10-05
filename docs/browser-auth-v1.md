# Авторизація браузера v1 — Етап 8, операція 2

Чинний browser contract. [Поточні версії](generated-code-reference.md).
Початкове приймання 26.09.2026 на backend 0.33.0 / migration 0016:
54 тести та Chromium PASS; це історичні числа з [Етапу 8](stage-8-test-backend.md).
Frontend session coordinator реалізовано в Етапі 10; [поточні перевірки](audit-2026-10-05-documentation.md).

## Навіщо ця операція

Перші API вже віддають права і фактичний склад модулів пристрою.
Тепер браузер повинен безпечно входити, відновлювати сесію після
перезавантаження сторінки та завершувати її. RBAC і tenant isolation
залишаються серверними перевірками на кожний запит.

## Терміни і зберігання

| Термін | Призначення |
|---|---|
| Access token | Короткоживучий JWT для Authorization: Bearer; типовий строк — 15 хвилин |
| Refresh token | Випадковий secret для оновлення access; браузер тримає його в HttpOnly cookie |
| HttpOnly | JavaScript не може прочитати cookie через document.cookie |
| Origin | Точна комбінація протоколу, host і port, наприклад http://127.0.0.1:3000 |
| CORS | Правила браузера для запитів між різними origins |
| CSRF | Спроба сторонньої сторінки виконати небажану дію з cookie користувача |
| Rate limit | Тимчасове обмеження частоти запитів; перевищення дає 429 з Retry-After |

Frontend зберігає access **лише в пам'яті**; access і refresh не записуються
в localStorage/sessionStorage. Браузерна JSON-відповідь не містить refresh.
У БД зберігається SHA-256 hash refresh, не початковий secret.
HttpOnly не усуває XSS: frontend має CSP та security regressions, але це не усуває потребу в незалежному security review.

## HTTP-контракт

Усі paths нижче мають prefix `/api/v1`.

| Метод і path | Вхід | Успішна відповідь |
|---|---|---|
| POST /auth/browser/login | JSON email/password, `otp` при ввімкненому TOTP | 200, access JSON та Set-Cookie refresh |
| POST /auth/browser/refresh | Cookie; body не потрібний | 200, новий access та нова refresh cookie |
| POST /auth/browser/logout | Cookie; body не потрібний | 204, відкликання сесії та видалення cookie |
| GET /auth/me | Authorization: Bearer access | Identity, поточна session та memberships |

Три browser POST вимагають **одночасно**:

- `Origin`, що точно входить до `AUTH_BROWSER_ORIGINS`;
- заголовок `X-TechBaza-CSRF: 1`;
- `credentials: 'include'` у fetch для передачі/збереження cookie.

Origin встановлює сам браузер; frontend не підміняє його вручну.
Відсутній Origin, `null`, чужий Origin, відсутній/інший custom header — 403.
Значення `1` не секрет: захист спирається на custom header, CORS preflight
та серверну перевірку exact Origin. SameSite є додатковою перевіркою.

Успішна відповідь login/refresh:

```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 900,
  "session_expires_in": 2591999
}
```

`session_expires_in` зменшується: refresh не продовжує абсолютний строк
сесії. Типове максимальне життя — 30 днів. Rotation робить попередній
refresh недійсним одразу після commit. З двох одночасних refresh лише один
успішний. Невдала відповідь не стирає cookie, щоб запізніла відмова не
перезаписала cookie успішного запиту.

Logout із поточною refresh cookie відкликає server-side session:
наступні запити з access цієї сесії повертають 401, навіть до expiry JWT.
Повторний logout або logout без cookie повертає 204.
Після нового успішного login попередня сесія з надісланої cookie відкликається.

## Правила реалізованого frontend

1. Після завантаження сторінки — один refresh для відновлення access у пам'яті.
2. На 401 API — один спільний refresh для паралельних запитів, потім максимум
   один дозволений повтор початкового запиту. Невалідна/revoked session
   веде до входу; network/5xx/429 має окремий стан recovery і не є доказом logout.
3. Login/refresh/logout серіалізуються також між вкладками. Потрібні
   Web Locks або еквівалентна міжвкладкова координація та BroadcastChannel
   для сигналу logout. Це реалізовано frontend coordinator Етапу 10.
4. Перед logout дочекатися поточного refresh. Logout зі старим secret
   після його rotation не ідентифікує поточну сесію; не запускати ці дії
   паралельно. Після 204 очистити access у всіх вкладках.
5. Не повторювати автоматично керувальну команду без її існуючого request_id.
6. На 429 врахувати Retry-After і показати час очікування. На 503 —
   тимчасову недоступність. На 403 не запускати нескінченний refresh.

Приклад браузерного виклику:

```javascript
const response = await fetch(`${apiBase}/api/v1/auth/browser/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-TechBaza-CSRF': '1' },
  body: JSON.stringify({ email, password }),
});
// Перед використанням body перевірити response.ok та HTTP status.
```

## Cookie, CORS і середовище

Cookie: `techbaza_refresh`, HttpOnly, SameSite=Strict,
Path=/api/v1/auth/browser, без Domain. Max-Age не виходить за строк сесії.
Звичайні API не авторизуються цією cookie: для них потрібний Bearer.

- `AUTH_COOKIE_SECURE=true` є стандартом backend поза локальним Compose.
- Локальний Compose явно задає false для HTTP loopback.
- Локальні origins за замовчуванням: http://localhost:3000 та http://127.0.0.1:3000.
- Використовувати той самий host для frontend/API: 127.0.0.1 з 127.0.0.1
  або localhost з localhost. Змішування host може заблокувати SameSite cookie.
- Публічні origins вимагають HTTPS, Secure=true і власного JWT secret;
  відомі development/example secrets та небезпечні origins відхиляються на старті.
- Wildcard, credentials у URL, path/query/fragment origins не дозволено.
- Порожній allowlist вимикає browser routes. CORS не є authentication для API.
- Розміщення frontend/API має бути same-site, бажано за одним origin/reverse proxy.
  Довільні різні сайти з SameSite=Strict цим контрактом не підтримуються.

Auth-відповіді мають `Cache-Control: no-store`, `Pragma: no-cache`.
Auth validation повертає 422 без відображення password/refresh input.
Інші validation responses проєкту не змінюються.

## Захист входу і PostgreSQL

| Параметр | Типове значення |
|---|---|
| AUTH_RATE_WINDOW_SECONDS | 300 секунд |
| AUTH_LOGIN_IP_LIMIT | 30 спроб за вікно на peer IP |
| AUTH_LOGIN_ACCOUNT_LIMIT | 10 спроб за вікно на нормалізований email |
| AUTH_SESSION_IP_LIMIT | 120 refresh/logout запитів за вікно на peer IP |

Ліміт враховує всі спроби, зокрема успішні, до перевірки password hash.
Старий JSON login і browser login використовують спільні лічильники:
обійти ліміт перемиканням маршруту не можна. Refresh/logout обох flows
також спільно обмежені. Некоректні payload відхиляються валідацією раніше.

Міграція 0016 створює `auth_rate_limits`; існуючі users/sessions не змінюються.
Ключ — HMAC від типу ліміту та IP/email, без їх зберігання відкритим текстом.
Atomic PostgreSQL upsert запобігає обходу паралельними запитами/workers.
Стан переживає перезапуск процесу. Вікно не подовжується кожною відмовою.
Лічильники з expiry старшим за годину видаляються порціями до 100 при
наступних auth-запитах; у період без запитів cleanup не виконується.
Якщо сховище ліміту недоступне, повертається 503, вхід не обходить захист.

Docker запускає Uvicorn з `--no-proxy-headers`: підставний X-Forwarded-For
не змінює IP для ліміту. Перед reverse proxy потрібні окреме налаштування
довірених proxy IP та перевірка реальної адреси клієнта. Інакше клієнти
за proxy/NAT ділять IP-ліміт. Rate limit не замінює інфраструктурний захист
від розподілених атак; навантажувальне налаштування виконується перед production.

## Сумісність і межі

JSON `/auth/login`, `/auth/refresh`, `/auth/logout` залишені для CLI та
попередніх сценаріїв. Browser frontend використовує нові cookie routes.
Активація з етикетки, TOTP MFA, recovery key, перелік/відкликання власних сесій та
програмна частина B2B/QR onboarding уже реалізовані; [контракт і межі](buyer-onboarding-v1.md).
Registration/recovery також вимагають exact Origin/CSRF. Публічні origins
вмикають MFA policy привілейованого доступу; factory API вимагає MFA і локально.
Email verification/reset, фізичний onboarding та повне виявлення reuse
token family ще не завершені. Ключі TOTP/recovery/заводу відокремлені від JWT;
[міграція наявної установки](account-key-operations-v1.md) обов'язкова.
Повторне використання старого refresh зараз дає 401; автоматичного
відкликання всієї сім'ї через reuse немає. Рольові перевірки не послаблено.

## Перевірки

Додано 6 перевірок без БД та 10 інтеграційних PostgreSQL-перевірок:
origins/CORS/CSRF, cookie flags, валідація без secrets, недоступне сховище,
справжній login/rotation/logout, негайний revoke access, invalid credentials,
disabled/expired sessions, legacy compatibility, account/IP limits,
expiry ліміту, паралельні входи та refresh.
На початковому прийманні загальний unittest набір мав **54 тести**.
Поточний набір і commit — у [звіті аудиту](audit-2026-10-05-documentation.md).

Окремий CI-крок запускає справжній Chromium: login, збереження cookie,
недоступність для document.cookie, refresh після reload, rotation,
блокування чужого origin і запиту без CSRF header, logout та 401 для access.
Він використовує тимчасові HTTP servers й тестового user на ізольованій БД;
Playwright не додається до production Docker image.

Локальне приймання: [журнал Етапу 8](stage-8-test-backend.md).

## Джерела рішень

- [OWASP: custom request headers, CORS і CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).
- [FastAPI: explicit CORS origins](https://fastapi.tiangolo.com/tutorial/cors/).
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
