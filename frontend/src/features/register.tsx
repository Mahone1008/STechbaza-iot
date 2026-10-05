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
type Schema = components["schemas"];

export function RegisterPage({ recovery = false }: { recovery?: boolean }) {
  const params = useSearchParams();
  const destination = safeLoginReturnTo(params.get("returnTo"));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run, fail } = useAccountAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      fail("Паролі мають збігатися.");
      return;
    }
    void run(async () => {
      const data = await apiRequest<Schema["RecoveryRead"]>({
        path: recovery ? "/api/v1/auth/recover" : "/api/v1/auth/register",
        method: "POST",
        csrf: true,
        body: recovery
          ? { email, recovery_key: recoveryKey, new_password: password }
          : { email, display_name: name, password },
      });
      setIssuedKey(parseRecovery(data));
      setPassword("");
      setConfirmation("");
      setRecoveryKey("");
    });
  }
  return (
    <main className="connect-page">
      <PageHeader
        title={recovery ? "Відновлення доступу" : "Створити обліковий запис"}
        description={
          recovery
            ? "Потрібен особистий ключ відновлення, збережений при реєстрації."
            : "Після реєстрації можна активувати контролер і створити свій об’єкт."
        }
      />
      <Card>
        {issuedKey ? (
          <>
            <h2>Збережіть ключ відновлення</h2>
            <p>
              Він показується один раз. Збережіть у менеджері паролів або надрукуйте та тримайте окремо від пароля. Ключ
              дозволяє відновити доступ, якщо ви втратите пароль чи застосунок автентифікації.
            </p>
            <code className="recovery-key">{issuedKey}</code>
            <p>Поштова скринька не створюється. Лист із паролем або ключем не надсилається.</p>
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
          <form onSubmit={submit}>
            {!recovery && (
              <TextField
                required
                label="Ваше ім’я"
                minLength={2}
                maxLength={160}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
            <TextField
              required
              label="Email для входу"
              type="email"
              autoComplete="username"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {recovery && (
              <TextField
                required
                label="Ключ відновлення"
                type="password"
                autoComplete="off"
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value.trim())}
              />
            )}
            <TextField
              required
              label={recovery ? "Новий пароль" : "Пароль"}
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              hint="Щонайменше 12 символів. Краще довга унікальна фраза."
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
            {recovery && (
              <p>
                Усі попередні сесії буде завершено. Двоетапний вхід потрібно налаштувати знову; старий ключ відновлення
                перестане діяти.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Зберігаємо…" : recovery ? "Відновити доступ" : "Зареєструватися"}
            </Button>
          </form>
        )}
      </Card>
      <Link href={`/login?returnTo=${encodeURIComponent(destination)}` as Route}>До входу</Link>
    </main>
  );
}
