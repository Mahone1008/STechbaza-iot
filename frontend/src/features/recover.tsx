"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiRequest, type components } from "@/lib/api";
import { parseRecovery } from "@/lib/api/onboarding";
import { safeLoginReturnTo } from "./login-model";
import { useAccountAction } from "./use-account-action";

export function RecoveryPage() {
  const params = useSearchParams();
  const destination = safeLoginReturnTo(params.get("returnTo"));
  const [email, setEmail] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAccountAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      if (password !== confirmation) throw new Error("Паролі не збігаються");
      const result = await apiRequest<components["schemas"]["RecoveryRead"]>({
        path: "/api/v1/auth/recover",
        method: "POST",
        csrf: true,
        credentials: "include",
        body: { email, recovery_key: recoveryKey, new_password: password },
      });
      setIssuedKey(parseRecovery(result));
      setPassword("");
      setConfirmation("");
      setRecoveryKey("");
    });
  };
  return (
    <main className="connect-page">
      <PageHeader
        title="Відновлення доступу"
        description="Введіть логін та особистий ключ відновлення, збережений під час активації або в налаштуваннях безпеки."
      />
      <Card title={issuedKey ? "Збережіть ключ відновлення" : "Дані для відновлення"}>
        {issuedKey ? (
          <>
            <p>Новий ключ показано один раз. Збережіть його окремо від пароля.</p>
            <code className="recovery-key">{issuedKey}</code>
            <label className="ui-row">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />Я зберіг
              ключ у безпечному місці
            </label>
            {saved && (
              <Link
                className="button button-primary"
                href={`/login?returnTo=${encodeURIComponent(destination)}` as Route}
              >
                Перейти до входу
              </Link>
            )}
          </>
        ) : (
          <form className="connect-fields" onSubmit={submit}>
            <TextField
              required
              label="Логін"
              autoComplete="username"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              required
              label="Ключ відновлення"
              type="password"
              autoComplete="off"
              value={recoveryKey}
              onChange={(event) => setRecoveryKey(event.target.value.trim())}
            />
            <TextField
              required
              label="Новий пароль"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              required
              label="Повторіть пароль"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <p>
              Усі попередні сесії буде завершено. Двоетапний вхід потрібно налаштувати знову; старий ключ відновлення
              перестане діяти.
            </p>
            {error && <p role="alert">{error}</p>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Зберігаємо…" : "Відновити доступ"}
            </Button>
          </form>
        )}
      </Card>
      <Link href={`/login?returnTo=${encodeURIComponent(destination)}` as Route}>До входу</Link>
    </main>
  );
}
