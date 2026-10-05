"use client";
import { useAccountAction } from "./use-account-action";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { parseRecovery } from "@/lib/api/onboarding";
import { AccountGate } from "./account-gate";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";

type Schema = components["schemas"];

export function SecurityPage() {
  return (
    <main className="connect-page">
      <PageHeader
        title="Безпека облікового запису"
        description="Двоетапний вхід, відновлення доступу та активні сесії."
      />
      <AccountGate returnTo="/account/security">
        <SecuritySettings />
      </AccountGate>
      <div className="ui-row">
        <Link href="/devices">До пристроїв</Link>
        <Link href="/factory">Реєстр виробника</Link>
      </div>
    </main>
  );
}

function SecuritySettings() {
  const { authorizedRequest, session, logout } = useAuthSession();
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [setup, setSetup] = useState<Schema["TotpSetupRead"] | null>(null);
  const [recovery, setRecovery] = useState("");
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const state = usePanelQuery({
    queryKey: ["account-security", key],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["SecurityRead"]>({
        path: "/api/v1/auth/security",
        signal,
      }),
  });
  const sessions = usePanelQuery({
    queryKey: ["account-sessions", key],
    intervalMs: 0,
    queryFn: (signal) =>
      authorizedRequest<Schema["SessionRead"][]>({
        path: "/api/v1/auth/sessions",
        signal,
      }),
  });
  const {
    busy,
    error,
    run: perform,
  } = useAccountAction(() => {
    state.refresh();
    sessions.refresh();
  });
  const startTotp = () =>
    void perform(async () => {
      setSetup(
        await authorizedRequest<Schema["TotpSetupRead"]>({
          path: "/api/v1/auth/security/totp/setup",
          method: "POST",
          body: { password },
        }),
      );
      setPassword("");
    });

  const confirmTotp = () =>
    void perform(async () => {
      await authorizedRequest({
        path: "/api/v1/auth/security/totp/confirm",
        method: "POST",
        body: { otp },
      });
      setSetup(null);
      setOtp("");
    });

  const rotateRecovery = () =>
    void perform(async () => {
      const result = await authorizedRequest<Schema["RecoveryRead"]>({
        path: "/api/v1/auth/security/recovery",
        method: "POST",
        body: { password, otp: otp || null },
      });
      setRecovery(parseRecovery(result));
      setPassword("");
      setOtp("");
    });

  const revokeSession = (item: Schema["SessionRead"]) =>
    void perform(async () => {
      if (item.current) await logout();
      else
        await authorizedRequest({
          path: `/api/v1/auth/sessions/${item.id}`,
          method: "DELETE",
        });
    });

  return (
    <>
      <Card title="Двоетапний вхід">
        {state.isError ? (
          <p role="alert">{apiErrorDisplayMessage(state.error)}</p>
        ) : !state.data ? (
          <p role="status">Завантаження…</p>
        ) : (
          <>
            <p>
              {state.data.mfa_enabled
                ? "Увімкнено: при вході потрібні пароль і код із застосунку."
                : "Додайте другий рівень захисту через застосунок автентифікації. Для заводського реєстру він обов’язковий."}
            </p>
            <TextField
              label="Поточний пароль для підтвердження"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Код із застосунку автентифікації"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              hint="Шість цифр; дочекайтеся нового коду після його використання."
            />
            {!state.data.mfa_enabled && !setup && (
              <Button disabled={busy || !password} onClick={startTotp}>
                Налаштувати двоетапний вхід
              </Button>
            )}
            {setup && (
              <div className="connect-fields">
                <p>Додайте обліковий запис у застосунок автентифікації вручну: TOTP, 6 цифр, 30 секунд.</p>
                <code className="recovery-key">{setup.secret}</code>
                <Button disabled={busy || !/^\d{6}$/.test(otp)} onClick={confirmTotp}>
                  Підтвердити код і ввімкнути
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
      <Card title="Ключ відновлення">
        <p>
          Створення нового ключа скасує попередній. Потрібен поточний пароль і, якщо ввімкнено двоетапний вхід, новий
          код.
        </p>
        <Button
          disabled={busy || !password || (!!state.data?.mfa_enabled && !/^\d{6}$/.test(otp))}
          onClick={rotateRecovery}
        >
          Створити новий ключ відновлення
        </Button>
        {recovery && (
          <>
            <p>Збережіть цей ключ. Повторно він не відображатиметься.</p>
            <code className="recovery-key">{recovery}</code>
            <Button onClick={() => setRecovery("")}>Я зберіг ключ</Button>
          </>
        )}
      </Card>
      <Card title="Активні сесії">
        {sessions.isError ? (
          <p role="alert">{apiErrorDisplayMessage(sessions.error)}</p>
        ) : (
          <ul className="device-events">
            {sessions.data?.map((item) => (
              <li key={item.id}>
                <strong>{item.current ? "Поточна сесія" : "Інша сесія"}</strong>
                <p>Вхід: {new Date(item.created_at).toLocaleString("uk-UA")}</p>
                <Button disabled={busy} onClick={() => revokeSession(item)}>
                  Завершити сесію
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
