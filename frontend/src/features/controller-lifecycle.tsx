"use client";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { ControllerQr } from "@/components/controller-qr";
import { apiErrorDisplayMessage, type components } from "@/lib/api";
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
    queryFn: (signal) =>
      authorizedRequest<Schema["ControllerStatus"]>({ path: `/api/v1/connect/${controllerId}/status`, signal }),
  });
  const { busy, error, run } = useAccountAction();
  if (!context.access.permissions.includes("capability.manage")) return null;
  const owner = context.access.organization_role === "owner" || context.access.platform_role === "superadmin";
  const titles = {
    rotate: "Оновити ключ доступу",
    revoke: "Відкликати доступ контролера",
    release: "Передати іншому власнику",
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!operation || !query.data || !confirmed) return;
    void run(async () => {
      const result = await authorizedRequest<Schema["ControllerStatus"] | Schema["TransferRead"]>({
        path: `/api/v1/connect/${controllerId}/access/${operation}`,
        method: "POST",
        timeoutMs: 30000,
        body: {
          password,
          otp: otp || null,
          reason,
          expected_generation: query.data!.generation,
          expected_credential_revision: query.data!.credential_revision,
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
        Зміна власника створює нову прив’язку. Історія та розклади залишаються у вашому об’єкті.
      </p>
      <Button aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
        {open ? "Згорнути дії з контролером" : "Керувати доступом"}
      </Button>
      {open && (
        <>
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
                    active: "Мережевий доступ активний.",
                    revoked: "Мережевий доступ відкликано.",
                  }[query.data.credential_state]
                }
              </p>
              <Button disabled={busy || query.isFetching} onClick={query.refresh}>
                Оновити стан доступу
              </Button>
              <div className="ui-row">
                {(["rotate", "revoke", ...(owner ? ["release"] : [])] as Array<keyof typeof titles>).map((value) => (
                  <Button
                    key={value}
                    disabled={busy}
                    onClick={() => {
                      setOperation(value);
                      setConfirmed(false);
                      setNotice("");
                    }}
                  >
                    {titles[value]}
                  </Button>
                ))}
              </div>
            </>
          )}
          {operation && (
            <form onSubmit={submit} className="equipment-action-form">
              <h4>{titles[operation]}</h4>
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
                label="Новий код автентифікатора, якщо ввімкнено MFA"
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
                <Button variant="primary" type="submit" disabled={busy || !confirmed}>
                  {busy ? "Підтверджуємо…" : "Підтвердити дію"}
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
              <p>Код показано один раз. Новий власник використає його після входу до власного облікового запису.</p>
              <code className="recovery-key">{transfer.activation_code}</code>
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
