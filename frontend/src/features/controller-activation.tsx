"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Card, TextField } from "@/components/ui";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";

export function ControllerActivation({ id }: { id: string }) {
  const { login } = useAuthSession();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAccountAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await login({ controller_id: id, password });
    });
  };

  return (
    <Card title="Активуйте свій контролер">
      <p>
        Введіть індивідуальний пароль із закритої частини етикетки. Окремо реєструватися чи вказувати email не потрібно.
      </p>
      <form className="connect-fields" onSubmit={submit}>
        <TextField
          label="Пароль з етикетки"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Перевіряємо…" : "Активувати контролер"}
        </Button>
      </form>
      <p>
        Після підтвердження створіть об’єкт і виберіть виробника та модель частотника. Для наступних входів збережіть
        новий постійний пароль і налаштуйте двоетапний вхід у майстрі активації.
      </p>
      <Link href={`/login?returnTo=${encodeURIComponent(`/connect/${id}`)}` as Route}>Увійти постійним логіном</Link>
    </Card>
  );
}
