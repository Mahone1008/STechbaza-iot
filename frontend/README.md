# Frontend

Вебінтерфейс KERUMO для клієнтів, сервісних спеціалістів та адміністраторів.
Внутрішні технічні ідентифікатори TechBaza поки зберігаються для сумісності
з прийнятим backend; це не змінює зовнішній бренд першого UI.

Інтерфейс модульний: віджети та controls показуються відповідно до обладнання,
датчиків і capabilities конкретного Device.

Прийнята основа — backend **0.38.0**, Етап H завершено 5/5.
Production frontend ще не розпочато: Next.js/React/TypeScript source відсутній.

## Поточна точка

Операцію **9.1** підготовлено до повторного користувацького приймання.
Після першого feedback прототип повністю перероблено у світлий, спокійний
industrial SaaS layout із чіткою hierarchy та мінімальним використанням
accent color.

- [сценарії, карта сторінок, visual system і правила станів](../docs/stage-9-op1-ux-and-mockups.md);
- [статичний інтерактивний прототип](mockups/stage9-1/index.html);
- [інструкція локального перегляду](mockups/stage9-1/README.md).

Операція не закрита до явного підтвердження користувача, тому roadmap
залишається **0/24**. Макет містить лише demo data, не викликає API і не
надсилає команди.

[План frontend v1](../docs/frontend-roadmap-v1.md): Етапи 9–14, 24 операції.
Після приймання 9.1 наступний крок — **9.2: Next.js/TypeScript strict,
design system, navigation shell і базові компоненти**.

Стек: React, Next.js, TypeScript. Джерело даних — чинний FastAPI API;
склад віджетів і доступних дій визначають modules/channels/permissions.
[Повторний огляд backend та його межі](../docs/backend-review-after-h-2026-09-27.md).
