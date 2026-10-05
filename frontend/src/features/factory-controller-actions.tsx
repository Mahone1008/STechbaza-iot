"use client";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";

type Schema = components["schemas"];
export function FactoryControllerActions({
  controller,
  onChanged,
  onKit,
}: {
  controller: Schema["FactoryRead"];
  onChanged: () => void;
  onKit: (kit: Schema["FactorySecrets"]) => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const [action, setAction] = useState<"quarantine" | "reset" | null>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useAccountAction(onChanged);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || !confirmed) return;
    void run(async () => {
      const path = `/api/v1/factory/controllers/${controller.id}/${action}`;
      if (action === "reset") {
        onKit(
          await authorizedRequest<Schema["FactorySecrets"]>({
            path,
            method: "POST",
            timeoutMs: 30000,
            body: {
              reason,
              expected_generation: controller.generation,
              test_reference: reference,
              factory_test_passed: true,
            },
          }),
        );
      } else await authorizedRequest({ path, method: "POST", timeoutMs: 30000, body: { reason } });
      setAction(null);
      setConfirmed(false);
    });
  };
  return (
    <div>
      <div className="ui-row">
        <Button
          disabled={busy || controller.status === "quarantined"}
          onClick={() => {
            setAction("quarantine");
            setConfirmed(false);
          }}
        >
          Карантин і відгук ключів
        </Button>
        {["ready", "quarantined"].includes(controller.status) && (
          <Button
            disabled={busy}
            onClick={() => {
              setAction("reset");
              setConfirmed(false);
            }}
          >
            Повернення та перевипуск комплекту
          </Button>
        )}
      </div>
      {action && (
        <form onSubmit={submit} className="equipment-action-form">
          <h4>{action === "reset" ? "Заводське повернення" : "Карантин контролера"}</h4>
          <p>
            {action === "reset"
              ? "Після фізичної перевірки буде видано нові ключі. Перепрошийте заводський файл; історія минулого покупця лишиться в його об’єкті."
              : "Заводський ключ і мережевий доступ контролера буде скасовано. Це не підтверджує фізичну зупинку двигуна."}
          </p>
          <TextField
            label={`Причина · ${controller.serial_number}`}
            required
            minLength={5}
            maxLength={240}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {action === "reset" && (
            <TextField
              label="Новий протокол заводської перевірки"
              required
              maxLength={160}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
          <label className="ui-row">
            <input
              required
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {action === "reset"
              ? "Фізичну перевірку після повернення пройдено; контролер зупинено та ізольовано"
              : "Підтверджую карантин і відкликання ключів цього контролера"}
          </label>
          <div className="ui-row">
            <Button type="submit" disabled={busy || !confirmed}>
              Підтвердити
            </Button>
            <Button disabled={busy} onClick={() => setAction(null)}>
              Скасувати
            </Button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
