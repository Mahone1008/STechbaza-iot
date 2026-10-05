"use client";

import { useEffect, useState } from "react";
import { ControllerQr } from "@/components/controller-qr";
import { Button, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";

export type ActivationProof = { password: string; otp: string; saved: boolean };

export function PermanentAccessFields({
  id,
  login,
  onChange,
}: {
  id: string;
  login: string;
  onChange: (value: ActivationProof) => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const [setup, setSetup] = useState<components["schemas"]["ActivationAccessRead"] | null>(null);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAccountAction();
  useEffect(() => {
    onChange({ password, otp, saved });
  }, [password, otp, saved, onChange]);

  const prepare = () =>
    void run(async () => {
      const result = await authorizedRequest<components["schemas"]["ActivationAccessRead"]>({
        path: `/api/v1/connect/${id}/security`,
        method: "POST",
      });
      if (result.login !== login) throw new Error("Дані доступу змінилися. Оновіть сторінку.");
      setSetup(result);
      setPassword(
        btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
          .replaceAll("+", "-")
          .replaceAll("/", "_"),
      );
      setOtp("");
      setSaved(false);
    });
  const download = () => {
    if (!setup || !password) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ login, password, recovery_key: setup.recovery_key }, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kerumo-access-${login}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="connect-fields" aria-label="Постійний доступ">
      <h3>Збережіть постійний доступ</h3>
      <p>
        Після активації заводські дані перестануть працювати. Для наступного входу потрібні новий логін, пароль і код із
        вашого застосунку автентифікації.
      </p>
      {!setup ? (
        <Button disabled={busy} onClick={prepare}>
          Створити постійний доступ
        </Button>
      ) : (
        <>
          <TextField label="Постійний логін" value={login} readOnly autoComplete="off" />
          <TextField label="Новий згенерований пароль" type="password" value={password} readOnly autoComplete="off" />
          <Button onClick={download}>Завантажити дані входу та ключ відновлення</Button>
          <p>Збережіть файл у надійному місці. Ключ відновлення допоможе, якщо втратите пароль або телефон.</p>
          <h3>Підключіть застосунок автентифікації</h3>
          <p>
            Відскануйте цей QR у застосунку автентифікації або додайте ключ вручну. Це особистий ключ; він не друкується
            на шильдику.
          </p>
          <ControllerQr url={setup.uri} label="QR для застосунку автентифікації" />
          <code className="recovery-key">{setup.secret}</code>
          <TextField
            label="Код підтвердження постійного доступу"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <label>
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} required /> Я
            зберіг нові дані входу та ключ відновлення
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
