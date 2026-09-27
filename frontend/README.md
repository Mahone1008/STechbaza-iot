# KERUMO Frontend

Адаптивний web UI для клієнтів, операторів і сервісних спеціалістів KERUMO.
Внутрішні backend/MQTT ідентифікатори TechBaza поки зберігаються для
сумісності з прийнятим backend 0.38.0.

## Поточний стан

- Операція 9.1 закрита: прийняті UX-сценарії та light industrial SaaS напрямок.
- Операція 9.2 у роботі: створено Next.js/TypeScript strict каркас, design
  tokens, navigation shell і базові компоненти.
- Live API adapter ще не підключений — це операція 9.3.
- Login, показники, пристрої й аварії зараз використовують типізовані demo data.

## Стек

- Next.js 16.3.6, App Router;
- React / React DOM 19.2.8 — версія, яку використовує офіційний шаблон Next.js 16.3.6;
- TypeScript strict;
- CSS variables + звичайний CSS без runtime styling dependency;
- ESLint flat config із `core-web-vitals` і TypeScript rules.

Node.js: **20.9.0+**. Перевірене локальне/CI оточення — Node.js 22.16.0.

## Запуск

У папці `frontend`:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Відкрити `http://127.0.0.1:3000`.

Повна перевірка з кореня repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op2.ps1
```

Запустити UI після перевірки:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage9-op2.ps1 -Start
```

## Маршрути каркаса

- `/login` — демонстраційна login-форма без backend auth;
- `/devices` — парк пристроїв;
- `/devices/north-pump` — модульна Device dashboard;
- `/alarms` — список інцидентів;
- `/ui-kit` — primitives і semantic states design system.

## Межі 9.2

Каркас не викликає FastAPI, не читає cookies/tokens і не публікує команди.
Він не видає demo data за live: у shell постійно показано `Каркас 9.2 · demo data`.
API base URL винесено до `.env.example`, але adapter і OpenAPI types будуть
реалізовані в операції 9.3.

UX-макет 9.1 збережено у `mockups/stage9-1/` як історичний acceptance artifact.
