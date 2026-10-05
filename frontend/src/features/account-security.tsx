"use client";
import { useAccountAction } from "./use-account-action";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ControllerQr } from "@/components/controller-qr";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { parseRecovery } from "@/lib/api/onboarding";
import { AccountGate } from "./account-gate";
import { useAuthSession } from "./auth-session";
import { useAccessContext } from "./access-context";
import { usePanelQuery } from "./use-panel-query";

type Schema = components["schemas"];
type SecurityAction = "totp" | "password" | "recovery" | "session";
type ActionProof = Readonly<{ password: string; otp: string }>;
const EMPTY_PROOF: ActionProof = { password: "", otp: "" };

function ConfirmationFields({
  purpose,
  proof,
  onChange,
  mfaEnabled,
  disabled,
}: {
  purpose: string;
  proof: ActionProof;
  onChange: (value: ActionProof) => void;
  mfaEnabled: boolean;
  disabled: boolean;
}) {
  return (
    <div className="connect-fields">
      <TextField
        label={`Поточний пароль для ${purpose}`}
        type="password"
        autoComplete="current-password"
        maxLength={128}
        value={proof.password}
        disabled={disabled}
        onChange={(event) => onChange({ ...proof, password: event.target.value })}
      />
      {mfaEnabled && (
        <TextField
          label={`Код із застосунку для ${purpose}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          value={proof.otp}
          disabled={disabled}
          onChange={(event) => onChange({ ...proof, otp: event.target.value })}
          hint="Використайте свіжий код: попередній уже не можна повторювати."
        />
      )}
    </div>
  );
}

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
      </div>
    </main>
  );
}

function SecuritySettings() {
  const { authorizedRequest, session, logout } = useAuthSession();
  const { snapshot } = useAccessContext();
  const profile = "profile" in snapshot ? snapshot.profile : null;
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [passwordProof, setPasswordProof] = useState<ActionProof>(EMPTY_PROOF);
  const [recoveryProof, setRecoveryProof] = useState<ActionProof>(EMPTY_PROOF);
  const [setup, setSetup] = useState<Schema["TotpSetupRead"] | null>(null);
  const [recovery, setRecovery] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [activeAction, setActiveAction] = useState<SecurityAction | null>(null);
  const [totpConfirmed, setTotpConfirmed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, activeAction]);
  useEffect(() => {
    if (totpConfirmed) successRef.current?.focus();
  }, [totpConfirmed]);
  const mfaEnabled = Boolean(totpConfirmed || state.data?.mfa_enabled);
  const securityReady = Boolean(state.data) && !state.isError;
  const startTotp = () =>
    void perform(async () => {
      setActiveAction("totp");
      setTotpConfirmed(false);
      setSetup(
        await authorizedRequest<Schema["TotpSetupRead"]>({
          path: "/api/v1/auth/security/totp/setup",
          method: "POST",
          body: { password },
        }),
      );
      setPassword("");
      setOtp("");
    });

  const confirmTotp = () =>
    void perform(async () => {
      setActiveAction("totp");
      setTotpConfirmed(false);
      await authorizedRequest({
        path: "/api/v1/auth/security/totp/confirm",
        method: "POST",
        body: { otp },
      });
      setSetup(null);
      setOtp("");
      setTotpConfirmed(true);
    });

  const rotateRecovery = () =>
    void perform(async () => {
      setActiveAction("recovery");
      const result = await authorizedRequest<Schema["RecoveryRead"]>({
        path: "/api/v1/auth/security/recovery",
        method: "POST",
        body: { password: recoveryProof.password, otp: recoveryProof.otp || null },
      });
      setRecovery(parseRecovery(result));
      setRecoveryProof(EMPTY_PROOF);
    });

  const revokeSession = (item: Schema["SessionRead"]) =>
    void perform(async () => {
      setActiveAction("session");
      if (item.current) await logout();
      else
        await authorizedRequest({
          path: `/api/v1/auth/sessions/${item.id}`,
          method: "DELETE",
        });
    });

  const changePassword = () =>
    void perform(async () => {
      setActiveAction("password");
      if (newPassword !== confirmation) throw new Error("Паролі мають збігатися.");
      await authorizedRequest({
        path: "/api/v1/auth/security/password",
        method: "POST",
        body: {
          password: passwordProof.password,
          otp: passwordProof.otp || null,
          new_password: newPassword,
        },
      });
      setPasswordProof(EMPTY_PROOF);
      setRecoveryProof(EMPTY_PROOF);
      setNewPassword("");
      setConfirmation("");
      setNotice("Пароль змінено. Інші сесії завершено; двоетапний захист збережено.");
    });

  const actionError = (action: SecurityAction) =>
    activeAction === action && error ? (
      <p className="notice notice-warning" role="alert" tabIndex={-1} ref={errorRef}>
        {error}
      </p>
    ) : null;

  return (
    <>
      <Card title="Двоетапний вхід" className="account-security-card">
        {state.isError ? (
          <p role="alert">{apiErrorDisplayMessage(state.error)}</p>
        ) : !state.data ? (
          <p role="status">Завантаження…</p>
        ) : mfaEnabled ? (
          <>
            <div className="notice notice-success" role="status" tabIndex={-1} ref={successRef}>
              <span aria-hidden="true">✓</span>
              <div className="notice-copy">
                <strong>Двоетапний вхід увімкнено</strong>
                <span>
                  {totpConfirmed
                    ? "Поточну сесію підтверджено. Налаштування завершено."
                    : "Для входу використовуйте свій пароль і код із застосунку автентифікації."}
                </span>
              </div>
            </div>
            <p>
              Видалення запису із застосунку не вимикає двоетапний вхід. Збережіть особистий ключ відновлення, щоб
              повернути доступ у разі втрати телефона або запису.
            </p>
            {!state.data.recovery_available && (
              <div className="notice notice-warning" role="status">
                <div className="notice-copy">
                  <strong>Створіть ключ відновлення</strong>
                  <span>Без нього ви не зможете самостійно відновити доступ, якщо втратите застосунок.</span>
                  <a href="#recovery-key-section">Перейти до створення ключа</a>
                </div>
              </div>
            )}
            <div className="ui-row">
              <Link className="button button-secondary" href="/devices">
                До пристроїв
              </Link>
              {profile?.platform_role === "superadmin" && (
                <Link className="button button-primary" href="/factory">
                  Відкрити заводський реєстр
                </Link>
              )}
            </div>
          </>
        ) : setup ? (
          <div className="connect-fields">
            <p className="notice notice-info">
              Пароль підтверджено. Залишилося підключити застосунок і підтвердити код.
            </p>
            <p>1. Відскануйте QR у застосунку автентифікації або додайте ключ вручну: TOTP, 6 цифр, 30 секунд.</p>
            <ControllerQr url={setup.uri} label="QR для застосунку автентифікації" />
            <code className="recovery-key">{setup.secret}</code>
            <p>2. Введіть свіжий шестизначний код із цього запису та натисніть кнопку підтвердження.</p>
            <TextField
              label="Код із застосунку автентифікації"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              value={otp}
              disabled={busy}
              onChange={(event) => setOtp(event.target.value)}
              hint="Дочекайтеся нового коду після його використання."
            />
            <Button disabled={busy || !/^\d{6}$/.test(otp)} onClick={confirmTotp}>
              {busy && activeAction === "totp" ? "Підтверджуємо код…" : "Підтвердити код і ввімкнути"}
            </Button>
          </div>
        ) : (
          <>
            <p>
              Додайте захист через застосунок автентифікації. Спочатку підтвердьте поточний пароль, потім додайте
              виданий QR або ключ у застосунок і введіть його код.
            </p>
            <TextField
              label="Поточний пароль для підтвердження"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button disabled={busy || !password} onClick={startTotp}>
              {busy && activeAction === "totp" ? "Готуємо налаштування…" : "Налаштувати двоетапний вхід"}
            </Button>
          </>
        )}
        {actionError("totp")}
        {activeAction === "totp" && error === "Код не підтверджено" && (
          <p>
            Використайте код від останнього виданого ключа. Перевірте автоматичне налаштування часу на телефоні й
            комп’ютері та дочекайтеся наступного коду.
          </p>
        )}
      </Card>
      <Card title="Постійний пароль" className="account-security-card">
        <p>
          Якщо пароль вам передала інша людина, замініть його на власний. Особистий пароль, згенерований під час
          активації, можна залишити.
        </p>
        <p>
          Введіть новий пароль двічі (від 12 символів) і підтвердьте зміну поточним паролем у цьому розділі. Якщо
          ввімкнено двоетапний вхід, додайте свіжий код із застосунку. Двоетапний захист зберігається.
        </p>
        <TextField
          label="Новий пароль"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <TextField
          label="Повторіть новий пароль"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <ConfirmationFields
          purpose="зміни пароля"
          proof={passwordProof}
          onChange={setPasswordProof}
          mfaEnabled={mfaEnabled}
          disabled={busy || !securityReady}
        />
        <Button
          onClick={changePassword}
          disabled={
            busy ||
            !securityReady ||
            !passwordProof.password ||
            newPassword.length < 12 ||
            newPassword !== confirmation ||
            (mfaEnabled && !/^\d{6}$/.test(passwordProof.otp))
          }
        >
          Змінити пароль
        </Button>
        {notice && (
          <p className="notice notice-success" role="status">
            {notice}
          </p>
        )}
        {actionError("password")}
      </Card>
      <Card id="recovery-key-section" title="Ключ відновлення" className="account-security-card">
        <p>
          Ключ дозволяє відновити доступ без коду із застосунку, якщо втратите пароль, телефон або видалите запис
          автентифікації. Перший ключ видається під час активації. Для інших облікових записів створіть його тут.
        </p>
        <p>
          Створення нового ключа скасує попередній. Потрібен поточний пароль і, якщо ввімкнено двоетапний вхід, новий
          код.
        </p>
        <ConfirmationFields
          purpose="оновлення ключа"
          proof={recoveryProof}
          onChange={setRecoveryProof}
          mfaEnabled={mfaEnabled}
          disabled={busy || !securityReady}
        />
        <Button
          disabled={
            busy || !securityReady || !recoveryProof.password || (mfaEnabled && !/^\d{6}$/.test(recoveryProof.otp))
          }
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
        {actionError("recovery")}
      </Card>
      <Card title="Активні сесії" className="account-security-card">
        <p>
          Це входи до вашого облікового запису в браузерах. Завершіть непотрібний або незнайомий сеанс, щоб закрити
          доступ із нього. Завершення поточної сесії означає вихід із цього браузера.
        </p>
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
        {actionError("session")}
      </Card>
    </>
  );
}
