"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, apiRequest, organizationRoleLabel, type components } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { useAccessContext } from "./access-context";
import { CreatePersonalAccount } from "./create-personal-account";
import { useEmailLinkToken } from "./email-link";
import { useAccountAction } from "./use-account-action";

export function InvitationPage() {
  const token = useEmailLinkToken();
  return process.env.NEXT_PUBLIC_PORTAL_MODE === "staff" ? (
    <StaffInvitationWithToken key={token} token={token} />
  ) : (
    <InvitationWithToken key={token} token={token} />
  );
}

function StaffInvitationWithToken({ token }: { token: string }) {
  const { session, login, authorizedRequest, logout } = useAuthSession();
  const { retryAccess } = useAccessContext();
  const [preview, setPreview] = useState<components["schemas"]["InvitationPreview"] | null>(null);
  const [linkError, setLinkError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [accepted, setAccepted] = useState(false);
  const { busy, error, run } = useAccountAction();
  const validToken = /^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/u.test(token);
  useEffect(() => {
    if (!validToken || session.status !== "authenticated") return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setPreview(null);
      setLinkError("");
    });
    void authorizedRequest<components["schemas"]["InvitationPreview"]>({
      path: "/api/v1/invitations/inspect",
      method: "POST",
      csrf: true,
      body: { token },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLinkError(apiErrorDisplayMessage(cause));
      });
    return () => controller.abort();
  }, [authorizedRequest, session.status, token, validToken]);
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await login({ email: email.trim().toLowerCase(), password, otp });
      setPassword("");
      setOtp("");
    });
  };
  const accept = () =>
    void run(async () => {
      if (!preview || !validToken || session.status !== "authenticated") return;
      await authorizedRequest({ path: "/api/v1/invitations/accept", method: "POST", csrf: true, body: { token } });
      setAccepted(true);
      retryAccess();
    });
  return (
    <main className="connect-page">
      <PageHeader title="Запрошення для монтажника" description="Власник надає доступ до своєї установки." />
      <Card title={preview?.organization_name ?? "Доступ до об’єкта"}>
        {!token ? (
          <p role="status">Відкрийте повне посилання з листа KERUMO.</p>
        ) : !validToken ? (
          <p role="alert">Посилання недійсне. Попросіть власника надіслати нове запрошення.</p>
        ) : session.status === "restoring" || session.status === "logging-out" ? (
          <p role="status">Перевіряємо вхід…</p>
        ) : session.status !== "authenticated" ? (
          <form className="connect-fields" onSubmit={signIn}>
            <p>Увійдіть у свій сервісний обліковий запис із поштою, на яку надіслано запрошення.</p>
            <TextField
              label="Електронна пошта"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Особистий пароль"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Код двоетапного входу"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
            {error && <p role="alert">{error}</p>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Перевіряємо…" : "Увійти"}
            </Button>
          </form>
        ) : accepted ? (
          <div className="connect-fields">
            <p className="notice notice-success" role="status">
              Запрошення прийнято. Ваш доступ: {preview ? organizationRoleLabel(preview.role) : "Сервіс"}.
            </p>
            <Link className="button button-primary" href="/operations?section=devices">
              До обладнання
            </Link>
          </div>
        ) : linkError ? (
          <div className="connect-fields">
            <p role="alert">{linkError} Попросіть власника перевірити адресу запрошення.</p>
            <Button disabled={busy} onClick={() => void logout()}>
              Увійти в інший обліковий запис
            </Button>
          </div>
        ) : !preview ? (
          <p role="status">Перевіряємо запрошення…</p>
        ) : (
          <div className="connect-fields">
            <p>
              Запрошення для {preview.email}. Роль: {organizationRoleLabel(preview.role)}.
            </p>
            {preview.site_names && <p>Об’єкти: {preview.site_names.join(", ")}.</p>}
            {preview.access_expires_at && (
              <p>Доступ до {new Date(preview.access_expires_at).toLocaleString("uk-UA")}.</p>
            )}
            <Button variant="primary" disabled={busy} onClick={accept}>
              Прийняти запрошення
            </Button>
            <Button disabled={busy} onClick={() => void logout()}>
              Увійти в інший обліковий запис
            </Button>
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </Card>
      {session.status === "authenticated" && <Link href="/operations">До сервісного кабінету</Link>}
    </main>
  );
}

function InvitationWithToken({ token }: { token: string }) {
  const { session, login, authorizedRequest, logout } = useAuthSession();
  const { retryAccess } = useAccessContext();
  const [preview, setPreview] = useState<components["schemas"]["InvitationPreview"] | null>(null);
  const [linkError, setLinkError] = useState("");
  const [newAccount, setNewAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [accepted, setAccepted] = useState(false);
  const { busy, error, run } = useAccountAction();
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<components["schemas"]["InvitationPreview"]>({
      path: "/api/v1/invitations/inspect",
      method: "POST",
      csrf: true,
      body: { token },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLinkError(apiErrorDisplayMessage(cause));
      });
    return () => controller.abort();
  }, [token]);
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      if (!preview) return;
      await login({ email: preview.email, password, ...(otp ? { otp } : {}) });
      setPassword("");
      setOtp("");
    });
  };
  const accept = () =>
    void run(async () => {
      await authorizedRequest({ path: "/api/v1/invitations/accept", method: "POST", csrf: true, body: { token } });
      setAccepted(true);
      retryAccess();
    });
  return (
    <main className="connect-page">
      <PageHeader title="Запрошення до KERUMO" description="Особистий доступ із правами, які призначив власник." />
      <Card title={preview?.organization_name ?? "Перевірка запрошення"}>
        {preview?.site_names !== undefined && (
          <p>
            {preview.site_names === null ? "Доступ до всієї організації" : `Об’єкти: ${preview.site_names.join(", ")}`}
          </p>
        )}
        {preview?.access_expires_at && <p>Доступ до {new Date(preview.access_expires_at).toLocaleString("uk-UA")}</p>}
        {linkError ? (
          <p role="alert">{linkError} Попросіть власника надіслати нове запрошення.</p>
        ) : !preview ? (
          <p role="status">{token ? "Перевіряємо посилання…" : "Відкрийте повне посилання з листа KERUMO."}</p>
        ) : accepted ? (
          <div className="connect-fields">
            <p className="notice notice-success" role="status">
              Запрошення прийнято. Ваш доступ: {organizationRoleLabel(preview.role)}.
            </p>
            <Link className="button button-primary" href="/organizations">
              Перейти до організацій
            </Link>
          </div>
        ) : newAccount ? (
          <CreatePersonalAccount token={token} email={preview.email} invitation />
        ) : session.status === "authenticated" ? (
          <div className="connect-fields">
            <p>
              Запрошення для {preview.email}. Роль: {organizationRoleLabel(preview.role)}.
            </p>
            <p>Поточний обліковий запис: {session.email}.</p>
            <Button variant="primary" disabled={busy} onClick={accept}>
              Прийняти запрошення
            </Button>
            <Button disabled={busy} onClick={() => void logout()}>
              Увійти в інший обліковий запис
            </Button>
            {error && <p role="alert">{error}</p>}
          </div>
        ) : (
          <form className="connect-fields" onSubmit={signIn}>
            <p>
              Запрошення для {preview.email}. Роль: {organizationRoleLabel(preview.role)}.
            </p>
            <TextField label="Електронна пошта" value={preview.email} readOnly autoComplete="username" />
            <TextField
              label="Особистий пароль"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Код двоетапного входу, якщо ввімкнено"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
            {error && <p role="alert">{error}</p>}
            <div className="ui-row">
              <Button variant="primary" type="submit" disabled={busy}>
                Увійти
              </Button>
              <Button disabled={busy} onClick={() => setNewAccount(true)}>
                Створити обліковий запис
              </Button>
            </div>
          </form>
        )}
      </Card>
      <Link href="/login">До звичайного входу</Link>
    </main>
  );
}
