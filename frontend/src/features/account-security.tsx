"use client";
import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, PageHeader, TextField } from "@/components/ui";
import { apiRequest, apiErrorDisplayMessage, type components } from "@/lib/api";
import { parseRecovery } from "@/lib/api/onboarding";
import { AccountGate } from "./connect";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { safeLoginReturnTo } from "./login-model";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="connect-page"><PageHeader title={recovery ? "Відновлення доступу" : "Створити обліковий запис"} description={recovery ? "Потрібен особистий ключ відновлення, збережений при реєстрації." : "Після реєстрації можна активувати контролер і створити свій об’єкт."} />
    <Card>{issuedKey ? <>
      <h2>Збережіть ключ відновлення</h2><p>Він показується один раз. Збережіть у менеджері паролів або надрукуйте та тримайте окремо від пароля. Ключ дозволяє відновити доступ, якщо ви втратите пароль чи застосунок автентифікації.</p>
      <code className="recovery-key">{issuedKey}</code><p>Поштова скринька не створюється. Лист із паролем або ключем не надсилається.</p>
      <label className="ui-row"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />Я зберіг ключ у безпечному місці</label>
      {saved && <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(destination)}` as Route}>Перейти до входу</Link>}
    </> : <form onSubmit={(event) => { event.preventDefault(); if (busy) return; setError(""); if (password !== confirmation) { setError("Паролі мають збігатися."); return; } setBusy(true); void apiRequest<Schema["RecoveryRead"]>({ path: recovery ? "/api/v1/auth/recover" : "/api/v1/auth/register", method: "POST", csrf: true, body: recovery ? { email, recovery_key: recoveryKey, new_password: password } : { email, display_name: name, password } }).then((data) => { setIssuedKey(parseRecovery(data)); setPassword(""); setConfirmation(""); setRecoveryKey(""); }).catch((cause: unknown) => setError(apiErrorDisplayMessage(cause))).finally(() => setBusy(false)); }}>
      {!recovery && <TextField required label="Ваше ім’я" minLength={2} maxLength={160} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />}
      <TextField required label="Email для входу" type="email" autoComplete="username" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
      {recovery && <TextField required label="Ключ відновлення" type="password" autoComplete="off" value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value.trim())} />}
      <TextField required label={recovery ? "Новий пароль" : "Пароль"} type="password" autoComplete="new-password" minLength={12} maxLength={128} hint="Щонайменше 12 символів. Краще довга унікальна фраза." value={password} onChange={(event) => setPassword(event.target.value)} />
      <TextField required label="Повторіть пароль" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      {recovery && <p>Усі попередні сесії буде завершено. Двоетапний вхід потрібно налаштувати знову; старий ключ відновлення перестане діяти.</p>}
      {error && <p role="alert">{error}</p>}<Button variant="primary" type="submit" disabled={busy}>{busy ? "Зберігаємо…" : recovery ? "Відновити доступ" : "Зареєструватися"}</Button>
    </form>}</Card><Link href={`/login?returnTo=${encodeURIComponent(destination)}` as Route}>До входу</Link>
  </main>;
}

export function SecurityPage() {
  return <main className="connect-page"><PageHeader title="Безпека облікового запису" description="Двоетапний вхід, відновлення доступу та активні сесії." /><AccountGate returnTo="/account/security"><SecuritySettings /></AccountGate><div className="ui-row"><Link href="/devices">До пристроїв</Link><Link href="/factory">Реєстр виробника</Link></div></main>;
}

function SecuritySettings() {
  const { authorizedRequest, session, logout } = useAuthSession();
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [setup, setSetup] = useState<Schema["TotpSetupRead"] | null>(null);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  const state = usePanelQuery({ queryKey: ["account-security", key], intervalMs: 0, queryFn: (signal) => authorizedRequest<Schema["SecurityRead"]>({ path: "/api/v1/auth/security", signal }) });
  const sessions = usePanelQuery({ queryKey: ["account-sessions", key], intervalMs: 0, queryFn: (signal) => authorizedRequest<Schema["SessionRead"][]>({ path: "/api/v1/auth/sessions", signal }) });
  const perform = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(""); try { await action(); state.refresh(); sessions.refresh(); } catch (cause) { setError(apiErrorDisplayMessage(cause)); } finally { setBusy(false); } };
  return <>
    <Card title="Двоетапний вхід">{state.isError ? <p role="alert">{apiErrorDisplayMessage(state.error)}</p> : !state.data ? <p role="status">Завантаження…</p> : <>
      <p>{state.data.mfa_enabled ? "Увімкнено: при вході потрібні пароль і код із застосунку." : "Додайте другий рівень захисту через застосунок автентифікації. Для заводського реєстру він обов’язковий."}</p>
      <TextField label="Поточний пароль для підтвердження" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <TextField label="Код із застосунку автентифікації" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={(event) => setOtp(event.target.value)} hint="Шість цифр; дочекайтеся нового коду після його використання." />
      {!state.data.mfa_enabled && !setup && <Button disabled={busy || !password} onClick={() => void perform(async () => { setSetup(await authorizedRequest<Schema["TotpSetupRead"]>({ path: "/api/v1/auth/security/totp/setup", method: "POST", body: { password } })); setPassword(""); })}>Налаштувати двоетапний вхід</Button>}
      {setup && <div className="connect-fields"><p>Додайте обліковий запис у застосунок автентифікації вручну: TOTP, 6 цифр, 30 секунд.</p><code className="recovery-key">{setup.secret}</code><Button disabled={busy || !/^\d{6}$/.test(otp)} onClick={() => void perform(async () => { await authorizedRequest({ path: "/api/v1/auth/security/totp/confirm", method: "POST", body: { otp } }); setSetup(null); setOtp(""); })}>Підтвердити код і ввімкнути</Button></div>}
    </>}</Card>
    <Card title="Ключ відновлення"><p>Створення нового ключа скасує попередній. Потрібен поточний пароль і, якщо ввімкнено двоетапний вхід, новий код.</p><Button disabled={busy || !password || (!!state.data?.mfa_enabled && !/^\d{6}$/.test(otp))} onClick={() => void perform(async () => { const result = await authorizedRequest<Schema["RecoveryRead"]>({ path: "/api/v1/auth/security/recovery", method: "POST", body: { password, otp: otp || null } }); setRecovery(parseRecovery(result)); setPassword(""); setOtp(""); })}>Створити новий ключ відновлення</Button>{recovery && <><p>Збережіть цей ключ. Повторно він не відображатиметься.</p><code className="recovery-key">{recovery}</code><Button onClick={() => setRecovery("")}>Я зберіг ключ</Button></>}</Card>
    <Card title="Активні сесії">{sessions.isError ? <p role="alert">{apiErrorDisplayMessage(sessions.error)}</p> : <ul className="device-events">{sessions.data?.map((item) => <li key={item.id}><strong>{item.current ? "Поточна сесія" : "Інша сесія"}</strong><p>Вхід: {new Date(item.created_at).toLocaleString("uk-UA")}</p><Button disabled={busy} onClick={() => void perform(async () => { if (item.current) await logout(); else await authorizedRequest({ path: `/api/v1/auth/sessions/${item.id}`, method: "DELETE" }); })}>Завершити сесію</Button></li>)}</ul>}</Card>
    {error && <p role="alert">{error}</p>}
  </>;
}
