"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { apiRequest, type components } from "@/lib/api";
import { parseRecovery } from "@/lib/api/onboarding";
import { useAuthSession } from "./auth-session";
import { downloadAccountAccess } from "./email-link";
import { useAccountAction } from "./use-account-action";

export function CreatePersonalAccount({
  token,
  email,
  invitation = false,
}: {
  token: string;
  email: string;
  invitation?: boolean;
}) {
  const router = useRouter();
  const { login } = useAuthSession();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [created, setCreated] = useState<components["schemas"]["AccountCreated"] | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAccountAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      if (password !== confirmation) throw new Error("Паролі мають збігатися.");
      const result = await apiRequest<components["schemas"]["AccountCreated"]>({
        path: invitation ? "/api/v1/invitations/register" : "/api/v1/auth/registration/complete",
        method: "POST",
        csrf: true,
        credentials: "include",
        body: { token, display_name: name, password },
      });
      parseRecovery(result);
      if (result.email !== email) throw new Error("Не вдалося підтвердити дані облікового запису. Повторіть вхід.");
      setCreated(result);
      setConfirmation("");
    });
  };
  const enter = () =>
    void run(async () => {
      if (!created || !saved) return;
      await login({ email: created.email, password });
      setPassword("");
      setCreated(null);
      router.replace((created.controller_id ? `/connect/${created.controller_id}` : "/devices") as Route);
    });

  return created ? (
    <div className="connect-fields">
      <div className="notice notice-success" role="status">
        <div className="notice-copy">
          <strong>Обліковий запис створено</strong>
          <span>Ваш логін: {created.email}</span>
        </div>
      </div>
      <p>Збережіть особистий ключ відновлення. Він поверне доступ, якщо забудете пароль або втратите застосунок.</p>
      <code className="recovery-key">{created.recovery_key}</code>
      <Button onClick={() => downloadAccountAccess(created.email, password, created.recovery_key)}>
        Завантажити дані входу та ключ відновлення
      </Button>
      <label className="ui-row">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />Я зберіг дані
        входу та ключ відновлення
      </label>
      <p>Двоетапний вхід необов’язковий. Його можна ввімкнути пізніше в налаштуваннях безпеки.</p>
      {error && <p role="alert">{error}</p>}
      <Button variant="primary" disabled={busy || !saved} onClick={enter}>
        Перейти до кабінету
      </Button>
    </div>
  ) : (
    <form className="connect-fields" onSubmit={submit}>
      <TextField label="Електронна пошта" value={email} readOnly autoComplete="username" />
      <TextField
        label="Ваше ім’я"
        required
        minLength={2}
        maxLength={160}
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Особистий пароль"
        required
        type="password"
        minLength={12}
        maxLength={128}
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        hint="Від 12 символів. Використовуйте окремий пароль для KERUMO."
      />
      <TextField
        label="Повторіть особистий пароль"
        required
        type="password"
        minLength={12}
        maxLength={128}
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
      />
      <p>
        Це ваш особистий доступ. Контролери додаються до нього окремо, повторна реєстрація для нового пристрою не
        потрібна.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? "Створюємо…" : "Створити обліковий запис"}
      </Button>
    </form>
  );
}
