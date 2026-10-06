"use client";

import { useState, type ReactNode } from "react";
import { Button, TextField } from "@/components/ui";
import { ModalDialog } from "@/components/modal-dialog";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { useAuthSession } from "@/features/auth-session";
import { usePanelQuery } from "@/features/use-panel-query";

export type Schema = components["schemas"];
export type Proof = { password: string; otp: string };
export const roleLabels: Record<string, string> = {
  user: "Клієнт",
  superadmin: "Головний адміністратор",
  service_admin: "Сервісний спеціаліст",
  owner: "Власник",
  admin: "Адміністратор",
  operator: "Оператор",
  viewer: "Спостерігач",
  service: "Сервіс",
};
export const dateLabel = (value: string | null) => (value ? new Date(value).toLocaleString("uk-UA") : "Ще немає");
export const bytesLabel = (value: unknown) =>
  typeof value === "number" ? `${(value / 1024 / 1024).toFixed(1)} МБ` : "Недоступно";

export function useStaffQuery<T>(path: string, query?: Record<string, string | number | boolean>, intervalMs = 0) {
  const { authorizedRequest, session } = useAuthSession();
  const identity = session.status === "authenticated" ? [session.email, session.sessionExpiresAt] : null;
  return usePanelQuery({
    queryKey: ["operations", identity, path, query ?? null],
    enabled: identity !== null,
    intervalMs,
    queryFn: (signal) => authorizedRequest<T>({ path, ...(query ? { query } : {}), signal }),
  });
}

export function QueryFeedback({ error, loading }: { error: unknown; loading: boolean }) {
  if (error)
    return (
      <p className="staff-feedback staff-feedback-error" role="alert">
        {apiErrorDisplayMessage(error)}
      </p>
    );
  if (loading)
    return (
      <p className="staff-feedback" role="status">
        Завантажуємо дані…
      </p>
    );
  return null;
}

export function Pager({
  offset,
  length,
  onChange,
  size = 25,
}: {
  offset: number;
  length: number;
  onChange: (offset: number) => void;
  size?: number;
}) {
  return (
    <div className="staff-pager">
      <span>Сторінка {Math.floor(offset / size) + 1}</span>
      <div className="ui-row">
        <Button size="small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>
          Назад
        </Button>
        <Button size="small" disabled={length < size} onClick={() => onChange(offset + size)}>
          Далі
        </Button>
      </div>
    </div>
  );
}

export function ActionDialog({
  title,
  description,
  children,
  onClose,
  onSubmit,
  label = "Підтвердити",
  danger = false,
  valid = true,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (proof: Proof, reason: string) => Promise<void>;
  label?: string;
  danger?: boolean;
  valid?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalDialog
      open
      title={title}
      description={description}
      onClose={() => {
        if (!busy) onClose();
      }}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            Скасувати
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy || !valid || !password || !/^\d{6}$/u.test(otp) || reason.trim().length < 5}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              setError("");
              void onSubmit({ password, otp }, reason.trim())
                .then(onClose)
                .catch((cause: unknown) => {
                  setError(apiErrorDisplayMessage(cause));
                  setOtp("");
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Виконуємо…" : label}
          </Button>
        </>
      }
    >
      <div className="connect-fields">
        {children}
        <TextField
          label="Причина зміни"
          value={reason}
          minLength={5}
          maxLength={240}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          hint="Причину буде збережено в журналі. Не вказуйте паролі чи ключі."
        />
        <TextField
          label="Ваш поточний пароль"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label="Свіжий код із вашого застосунку"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          disabled={busy}
          onChange={(event) => setOtp(event.target.value)}
          hint="Після використання коду дочекайтеся наступного."
        />
        {error && (
          <p className="staff-feedback staff-feedback-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ModalDialog>
  );
}
