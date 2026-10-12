"use client";
import { useState, type FormEvent } from "react";
import { RefreshAction } from "./refresh-actions";
import { Button, TextField } from "@/components/ui";
import { ControllerQr } from "@/components/controller-qr";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
import { invalidResponse } from "@/lib/api/access";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelQuery } from "./use-panel-query";
import { useAccountAction } from "./use-account-action";

type Schema = components["schemas"];
export function ControllerLifecycle({
  context,
  controllerId,
  onSaved,
}: {
  context: ReadyAccessSnapshot;
  controllerId: string;
  onSaved: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<"rotate" | "revoke" | "release" | null>(null);
  const [review, setReview] = useState<{ controllerId: string; generation: number; credentialRevision: number } | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [transfer, setTransfer] = useState<Schema["TransferRead"] | null>(null);
  const [url, setUrl] = useState("");
  const query = usePanelQuery({
    queryKey: ["controller-lifecycle", context.scope, controllerId],
    enabled: open && !transfer,
    intervalMs: 0,
    queryFn: async (signal) => {
      const path = `/api/v1/connect/${controllerId}/status`;
      const status = await authorizedRequest<Schema["ControllerStatus"]>({ path, signal });
      if (
        status.controller_id !== controllerId ||
        !Number.isSafeInteger(status.generation) ||
        status.generation < 1 ||
        !Number.isSafeInteger(status.credential_revision) ||
        status.credential_revision < 0
      )
        invalidResponse(path, "matching controller access status");
      return status;
    },
  });
  const { busy, error, run, fail } = useAccountAction();
  if (!context.access.permissions.includes("capability.manage")) return null;
  const owner = context.access.organization_role === "owner" || context.access.platform_role === "superadmin";
  const titles = {
    rotate: "Оновити доступ контролера",
    revoke: "Вимкнути доступ контролера",
    release: "Передати іншому власнику",
  };
  const descriptions = {
    rotate:
      "Замінює мережевий ключ контролера. Після підтвердження він отримає новий ключ; дозвіл на пуск потрібно відновити локально.",
    revoke: "Забороняє цьому контролеру підключатися до сервісу. Особистий обліковий запис залишається активним.",
    release:
      "Від’єднує контролер від вашого об’єкта та створює комплект для нового власника. Історія й розклади залишаються у вас.",
  };
  const changed =
    !!review &&
    (review.controllerId !== controllerId ||
      !query.data ||
      review.generation !== query.data.generation ||
      review.credentialRevision !== query.data.credential_revision);
  const canReview = !!query.data && query.active && !query.isError && !query.isFetching;
  const choose = (value: NonNullable<typeof operation>) => {
    if (!query.data || !canReview || busy) return;
    setOperation(value);
    setReview({ controllerId, generation: query.data.generation, credentialRevision: query.data.credential_revision });
    setConfirmed(false);
    setPassword("");
    setOtp("");
    setReason("");
    setNotice("");
    fail("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!operation || !query.data || !review || changed || !confirmed || !canReview) return;
    void run(async () => {
      const result = await authorizedRequest<Schema["ControllerStatus"] | Schema["TransferRead"]>({
        path: `/api/v1/connect/${review.controllerId}/access/${operation}`,
        method: "POST",
        timeoutMs: 30000,
        body: {
          password,
          otp: otp || null,
          reason,
          expected_generation: review.generation,
          expected_credential_revision: review.credentialRevision,
          stopped_and_isolated: true,
        },
      });
      setPassword("");
      setOtp("");
      setOperation(null);
      setConfirmed(false);
      if ("activation_code" in result) {
        setTransfer(result);
        setUrl(`${window.location.origin}${result.qr_path}`);
      } else {
        setNotice(
          result.access_revoked
            ? "Доступ відкликано. Керування вимкнено."
            : "Новий ключ підтверджено шлюзом. Контролер завантажить його автоматично; потрібен новий локальний ARM.",
        );
        query.refresh();
      }
      onSaved();
    });
  };
  const download = () => {
    if (!transfer) return;
    const blob = URL.createObjectURL(
      new Blob([JSON.stringify({ ...transfer, public_url: url }, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = blob;
    link.download = `handover-${controllerId}.json`;
    link.click();
    URL.revokeObjectURL(blob);
  };
  return (
    <section className="equipment-actions" aria-label="Доступ і передача контролера">
      <h3>Доступ і передача контролера</h3>
      <p className="help-copy">
        Передайте контролер новому власнику або змініть його доступ до сервісу. Ваш особистий пароль не змінюється.
      </p>
      <Button
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          if (open) {
            setOperation(null);
            setReview(null);
            setConfirmed(false);
            setPassword("");
            setOtp("");
            setReason("");
            fail("");
          }
          setOpen(!open);
        }}
      >
        {open ? "Згорнути дії" : "Керувати доступом"}
      </Button>
      {open && (
        <>
          <RefreshAction
            available={!transfer}
            disabled={busy || !query.active || query.isFetching}
            error={query.isError}
            onRefresh={query.refresh}
          />
          {query.isError && !transfer && (
            <p role="alert">
              {apiErrorDisplayMessage(query.error)} <Button onClick={query.refresh}>Повторити</Button>
            </p>
          )}
          {query.data && !transfer && (
            <>
              <p>
                {
                  {
                    not_issued: "Контролер ще не отримав робочий ключ.",
                    pending: "Очікуємо підтвердження зміни від шлюзу.",
                    active: "Контролеру дозволено підключатися до сервісу.",
                    revoked: "Мережевий доступ відкликано.",
                  }[query.data.credential_state]
                }
              </p>

              {owner && (
                <div className="equipment-task">
                  <p>Якщо продаєте або передаєте контролер іншій людині.</p>
                  <Button disabled={busy || !canReview} onClick={() => choose("release")}>
                    {titles.release}
                  </Button>
                </div>
              )}
              <details className="equipment-secondary">
                <summary>Захист підключення контролера</summary>
                <p className="help-copy">
                  Оновіть мережевий ключ або вимкніть доступ пристрою. Перед дією потрібно зупинити й ізолювати
                  установку.
                </p>
                <div className="ui-row">
                  <Button disabled={busy || !canReview} onClick={() => choose("rotate")}>
                    {titles.rotate}
                  </Button>
                  <Button disabled={busy || !canReview} onClick={() => choose("revoke")}>
                    {titles.revoke}
                  </Button>
                </div>
              </details>
            </>
          )}
          {operation && (
            <form
              onSubmit={submit}
              className="equipment-action-form"
              onChange={(event) => {
                if (!(event.target instanceof HTMLInputElement && event.target.type === "checkbox"))
                  setConfirmed(false);
              }}
            >
              <h4>{titles[operation]}</h4>
              <p>{descriptions[operation]}</p>
              {changed && <p role="alert">Стан доступу змінився. Скасуйте дію та відкрийте її знову для перевірки.</p>}
              <p>
                {operation === "release"
                  ? "Після підтвердження старий пристрій стане архівним. Збережіть одноразовий комплект і передайте його новому власнику окремо від публічного QR."
                  : "Перед дією зупиніть двигун, виконайте DISARM, вимкніть розклади та дочекайтеся завершення команд."}
              </p>
              <TextField
                label="Причина"
                required
                minLength={5}
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <TextField
                label="Ваш пароль для підтвердження"
                required
                type="password"
                autoComplete="current-password"
                value={password}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
              />
              <TextField
                label="Код із застосунку, якщо ввімкнено двоетапний вхід"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
              <label className="ui-row">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Двигун зупинено, установку ізольовано; наслідки операції зрозумілі
              </label>
              <div className="ui-row">
                <Button
                  variant={operation === "revoke" ? "danger" : "primary"}
                  type="submit"
                  disabled={busy || changed || !confirmed || !canReview}
                >
                  {busy
                    ? "Підтверджуємо…"
                    : operation === "release"
                      ? "Підтвердити передачу"
                      : operation === "revoke"
                        ? "Підтвердити вимкнення доступу"
                        : "Підтвердити оновлення доступу"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setOperation(null);
                    setPassword("");
                    setOtp("");
                  }}
                >
                  Скасувати
                </Button>
              </div>
            </form>
          )}
          {transfer && (
            <div className="equipment-action-form" role="status">
              <h4>Контролер готовий до передачі</h4>
              <ControllerQr url={url} />
              <p>{url}</p>
              <p>
                Новий власник активує пристрій цим паролем, використовуючи свій обліковий запис. Двоетапний вхід він
                може ввімкнути за бажанням. Ваш особистий кабінет і його захист залишаться у вас. Дані показано один
                раз; збережіть комплект.
              </p>
              <p>
                Логін: <code className="recovery-key">{transfer.login}</code>
              </p>
              <p>
                Одноразовий пароль активації: <code className="recovery-key">{transfer.password}</code>
              </p>
              <Button onClick={download}>Завантажити комплект передачі</Button>
              <p>
                Передайте також закриту картку локального Wi-Fi. Новий власник має фізично підтвердити обладнання на
                контролері.
              </p>
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p role="alert" className="notice notice-warning">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
