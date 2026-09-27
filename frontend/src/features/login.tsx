"use client";

import type { FormEvent } from "react";

import { Brand } from "@/components/app-shell";
import { Button, TextField } from "@/components/ui";

export function LoginPanel() {
  const submitDemo = (event: FormEvent<HTMLFormElement>) => event.preventDefault();

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Про платформу KERUMO">
        <Brand />
        <div className="login-message">
          <p className="eyebrow">Промисловий контроль без зайвого шуму</p>
          <h1>Обладнання, показники та аварії — в одному зрозумілому кабінеті.</h1>
          <p>
            KERUMO поєднує модульні контролери, частотні перетворювачі та датчики,
            не змішуючи стан зв’язку з фактичним результатом команди.
          </p>
        </div>
        <div className="login-features">
          <div className="login-feature"><strong>Модульність</strong><span>Лише встановлені можливості</span></div>
          <div className="login-feature"><strong>Контроль</strong><span>ACK і Result показуються окремо</span></div>
          <div className="login-feature"><strong>Безпека</strong><span>Права перевіряє backend</span></div>
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-card">
          <Brand />
          <h2>Вхід до кабінету</h2>
          <p>Каркас операції 9.2. Форма поки не підключена до backend.</p>
          <form className="login-form" onSubmit={submitDemo}>
            <TextField label="Email" type="email" placeholder="name@company.ua" autoComplete="username" />
            <TextField label="Пароль" type="password" placeholder="Введіть пароль" autoComplete="current-password" />
            <Button type="submit" variant="primary" fullWidth>Увійти</Button>
          </form>
          <div className="login-support"><span>Потрібна допомога?</span><a href="mailto:admin@example.invalid">Звернутися до адміністратора</a></div>
          <div className="login-security">Credentials не зашиті у bundle. Реальний browser auth починається в Етапі 10.</div>
        </div>
      </section>
    </main>
  );
}
