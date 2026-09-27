# UX-макет KERUMO — Етап 9.1

Це статичний інтерактивний макет, а не production frontend і не підключення до API.
Він фіксує інформаційну архітектуру, стиль, ключові сторінки, мобільну адаптацію
та обов'язкові стани першої версії інтерфейсу.

## Перегляд у Windows

У корені репозиторію:

```powershell
Start-Process .\frontend\mockups\stage9-1\index.html
```

Або через локальний HTTP-сервер:

```powershell
python -m http.server 3000 --directory .\frontend\mockups\stage9-1
```

Після цього відкрити `http://127.0.0.1:3000`.

## Екрани

- `#login` — вхід;
- `#devices` — парк пристроїв;
- `#device` — модульна панель KERUMO V5;
- `#alarms` — аварії та події;
- `#states` — loading/empty/offline/stale/missing/invalid та lifecycle команд.

Макет використовує лише демонстраційні значення. Він не надсилає команди,
не зберігає пароль і не підміняє backend authorization.
