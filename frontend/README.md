# Frontend

Вебінтерфейс KERUMO для клієнтів, сервісних спеціалістів та адміністраторів.
Внутрішні технічні ідентифікатори TechBaza поки зберігаються для сумісності
з прийнятим backend; це не змінює зовнішній бренд першого UI.

Інтерфейс модульний: віджети та controls показуються відповідно до обладнання,
датчиків і capabilities конкретного Device.

Прийнята основа — backend **0.38.0**, Етап H завершено 5/5.

## Поточна точка

Операцію **9.1** закрито 27.09.2026 після користувацького приймання ревізії 2.
Погоджено light industrial SaaS visual direction KERUMO, інформаційну
hierarchy, desktop/mobile layout, ролі, модульність і стани даних/команд.

- [прийняті сценарії, карта сторінок, visual system і правила станів](../docs/stage-9-op1-ux-and-mockups.md);
- [статичний UX-прототип](mockups/stage9-1/index.html);
- [інструкція локального перегляду](mockups/stage9-1/README.md).

Статус roadmap: **1/24**. Етап 9: **1/4**.

Статичний preview є артефактом UX-приймання, а не production frontend. Він
містить demo data, не викликає API і не надсилає команд. Підтримуваний код
з TypeScript/React, design tokens, accessibility, lint/typecheck і tests
створюється в наступній операції.

**Наступний крок — 9.2: Next.js/TypeScript strict, design system, navigation
shell і базові компоненти.**

[План frontend v1](../docs/frontend-roadmap-v1.md): Етапи 9–14, 24 операції.
Джерело даних майбутнього UI — чинний FastAPI API; склад віджетів і доступних
дій визначають modules/channels/permissions.
