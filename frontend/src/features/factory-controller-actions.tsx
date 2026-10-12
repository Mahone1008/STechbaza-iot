"use client";
import { useState, type FormEvent } from "react";
import { Button, SelectField, TextField } from "@/components/ui";
import type { components } from "@/lib/api";
import { useAuthSession } from "./auth-session";
import { useAccountAction } from "./use-account-action";
import { FactoryEquipmentPreparation } from "./factory-equipment-preparation";
import type { FactoryPreparationResult } from "./factory-equipment-model";

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
  const [action, setAction] = useState<"quarantine" | "reset" | "transport" | "equipment" | null>(null);
  const [preparation, setPreparation] = useState<FactoryPreparationResult>({
    equipment: null,
    valid: true,
    error: null,
  });
  const [preparationReview, setPreparationReview] = useState<{ generation: number; revision: number } | null>(null);
  const preparationChanged =
    !!preparationReview &&
    (preparationReview.generation !== controller.generation ||
      preparationReview.revision !== (controller.preparation_revision ?? 0) ||
      !controller.preparation_editable);
  const [transport, setTransport] = useState<"wifi" | "lte">(controller.network_transport ?? "wifi");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useAccountAction(onChanged);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (action === "equipment") {
      if (!preparation.valid || !preparationReview || preparationChanged) return;
      void run(async () => {
        await authorizedRequest({
          path: `/api/v1/factory/controllers/${controller.id}/equipment`,
          method: "PATCH",
          body: {
            expected_generation: preparationReview.generation,
            expected_preparation_revision: preparationReview.revision,
            equipment: preparation.equipment,
          },
        });
        setAction(null);
      });
      return;
    }
    if (!action || !confirmed) return;
    void run(async () => {
      const path = `/api/v1/factory/controllers/${controller.id}/${action}`;
      if (action === "transport") {
        await authorizedRequest({
          path,
          method: "PATCH",
          body: { network_transport: transport, expected_generation: controller.generation },
        });
      } else if (action === "reset") {
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
        {controller.preparation_editable && (
          <Button
            disabled={busy}
            onClick={() => {
              setPreparation({
                equipment: controller.prepared_equipment ?? null,
                valid: !controller.prepared_equipment,
                error: null,
              });
              setPreparationReview({
                generation: controller.generation,
                revision: controller.preparation_revision ?? 0,
              });
              setAction("equipment");
            }}
          >
            {controller.prepared_equipment ? "Змінити підготовлений паспорт" : "Підготувати паспорт обладнання"}
          </Button>
        )}
        {controller.transport_editable && (
          <Button
            disabled={busy}
            onClick={() => {
              setAction("transport");
              setTransport(controller.last_contact_transport ?? controller.network_transport ?? "wifi");
              setConfirmed(false);
            }}
          >
            Змінити тип інтернету
          </Button>
        )}
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
      {action === "equipment" ? (
        <form onSubmit={submit} className="equipment-action-form">
          <h4>Паспорт · {controller.serial_number}</h4>
          <p className="help-copy">
            Підготовка для покупця та монтажника. Після підтвердження установки зміни виконуються через сервіс
            обладнання. QR і власник залишаються тими самими.
          </p>
          <FactoryEquipmentPreparation
            initial={controller.prepared_equipment ?? null}
            onChange={setPreparation}
            disabled={busy}
          />
          {preparationChanged && (
            <p role="alert">
              Паспорт або стан контролера змінився. Закрийте форму й відкрийте її знову, щоб перевірити актуальні дані.
            </p>
          )}
          <div className="ui-row">
            <Button variant="primary" type="submit" disabled={busy || !preparation.valid || preparationChanged}>
              Зберегти підготовлений паспорт
            </Button>
            <Button disabled={busy} onClick={() => setAction(null)}>
              Скасувати
            </Button>
          </div>
        </form>
      ) : (
        action && (
          <form onSubmit={submit} className="equipment-action-form">
            <h4>
              {action === "reset"
                ? "Заводське повернення"
                : action === "transport"
                  ? "Тип інтернету контролера"
                  : "Карантин контролера"}
            </h4>
            <p>
              {action === "reset"
                ? "Після фізичної перевірки буде видано нові ключі. Перепрошийте заводський файл; історія минулого покупця лишиться в його об’єкті."
                : action === "transport"
                  ? "Можна виправити до першого підтвердженого підключення плати. Вибір має збігатися з модулем і заводською прошивкою; зміна на сайті не перепрограмовує плату."
                  : "Заводський ключ і мережевий доступ контролера буде скасовано. Це не підтверджує фізичну зупинку двигуна."}
            </p>
            {action === "transport" ? (
              <SelectField
                label={`Інтернет · ${controller.serial_number}`}
                value={transport}
                onChange={(event) => {
                  setTransport(event.target.value as "wifi" | "lte");
                  setConfirmed(false);
                }}
              >
                <option value="wifi">Wi-Fi</option>
                <option value="lte">4G / SIM-картка</option>
              </SelectField>
            ) : (
              <TextField
                label={`Причина · ${controller.serial_number}`}
                required
                minLength={5}
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
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
                : action === "transport"
                  ? "Тип мережі звірено з модулем і прошивкою цієї плати"
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
        )
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
