"use client";
import { EquipmentActions } from "./equipment-actions";
import { ControllerLifecycle } from "./controller-lifecycle";
import { useState } from "react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useAuthSession } from "@/features/auth-session";
import type { ReadyAccessSnapshot } from "@/features/access-context";
import { usePanelQuery } from "@/features/use-panel-query";
import { apiErrorDisplayMessage } from "@/lib/api";
import { equipmentStateLabels, parseEquipmentPassport } from "@/lib/api/equipment";
import { formatSeen } from "@/lib/api/inventory";

export function EquipmentPassportPanel({
  context,
  expanded = false,
}: {
  context: ReadyAccessSnapshot;
  expanded?: boolean;
}) {
  const device = context.activeDevice!;
  const [open, setOpen] = useState(expanded);
  const { authorizedRequest } = useAuthSession();
  const query = usePanelQuery({
    queryKey: ["equipment-passport", context.scope, context.activeOrganization.id, device.id],
    enabled: open,
    intervalMs: 0,
    queryFn: async (signal) =>
      parseEquipmentPassport(
        await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/equipment`, signal }),
        device,
      ),
  });
  const data = query.data;
  const [knownControllerId, setKnownControllerId] = useState<string | null>(null);
  if (data?.controller_id && data.controller_id !== knownControllerId) setKnownControllerId(data.controller_id);
  return (
    <Card title="Обладнання">
      {!expanded && (
        <Button aria-expanded={open} aria-controls="equipment-passport" onClick={() => setOpen(!open)}>
          {open ? "Згорнути паспорт" : "Паспорт обладнання"}
        </Button>
      )}
      {open && (
        <div id="equipment-passport" className="equipment-passport">
          <div className="ui-row">
            <Button disabled={!query.active || query.isFetching} onClick={query.refresh}>
              Оновити паспорт
            </Button>
          </div>
          {query.isPending ? (
            <p role="status">Завантаження паспорта…</p>
          ) : query.isError ? (
            <p role="alert">{apiErrorDisplayMessage(query.error)}</p>
          ) : (
            data && (
              <>
                <StatusBadge
                  tone={
                    data.configuration_state === "verified"
                      ? "success"
                      : data.configuration_state === "legacy"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {equipmentStateLabels[data.configuration_state]}
                </StatusBadge>
                <p className="help-copy">Паспорт завантажується на запит. Реєстрація модуля не вмикає керування ним.</p>
                {data.modules.length === 0 ? (
                  <p>
                    Обладнання ще не внесено в паспорт. Для заповнення потрібні модель зі шильдика та перевірка
                    підключення. Зверніться до адміністратора об’єкта.
                  </p>
                ) : (
                  data.modules
                    .filter((module) => !module.retired_at)
                    .map((module) => (
                      <section key={module.id} className="equipment-module" aria-label={module.name}>
                        <h3>
                          {module.name}
                          {module.retired_at ? " · архів" : ""}
                        </h3>
                        <dl className="overview-details">
                          <div>
                            <dt>Установка</dt>
                            <dd>{data.installations.find((item) => item.id === module.installation_id)?.name}</dd>
                          </div>
                          <div>
                            <dt>Модель</dt>
                            <dd>
                              {module.manufacturer} {module.model}
                            </dd>
                          </div>
                          <div>
                            <dt>Серія · місце підключення</dt>
                            <dd>
                              {module.series} · {module.slot}
                            </dd>
                          </div>
                          <div>
                            <dt>Серійний номер</dt>
                            <dd>{module.serial_number || "Не зазначено"}</dd>
                          </div>
                          <div>
                            <dt>Ревізія обладнання / ПЗ</dt>
                            <dd>
                              {module.hardware_revision || "Не зазначено"} /{" "}
                              {module.software_revision || "Не зазначено"}
                            </dd>
                          </div>
                          {module.motor && (
                            <div>
                              <dt>Номінальна частота двигуна</dt>
                              <dd>{module.motor.rated_frequency_hz} Гц</dd>
                            </div>
                          )}
                        </dl>
                      </section>
                    ))
                )}
                {data.modules.some((module) => module.retired_at) && (
                  <details>
                    <summary>Історія заміненого обладнання</summary>
                    <ul className="device-events">
                      {data.modules
                        .filter((module) => module.retired_at)
                        .map((module) => (
                          <li key={module.id}>
                            <strong>
                              {module.manufacturer} {module.model}
                            </strong>
                            <p>
                              Серійний номер: {module.serial_number || "Не зазначено"} · Ревізії:{" "}
                              {module.hardware_revision || "—"} / {module.software_revision || "—"}
                            </p>
                            <p>Замінено: {formatSeen(module.retired_at!, context.activeSite?.timezone ?? "UTC")}</p>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                <EquipmentActions context={context} passport={data} onSaved={query.refresh} />
                {data.desired && (
                  <section aria-label="Конфігурація обладнання">
                    <h3>Узгодження з контролером</h3>
                    <dl className="overview-details">
                      <div>
                        <dt>Профіль</dt>
                        <dd>
                          {data.desired.manifest.profile_id} · v{data.desired.manifest.profile_version}
                        </dd>
                      </div>
                      <div>
                        <dt>Збережена / повідомлена ревізія</dt>
                        <dd>
                          {data.desired.manifest.revision} / {data.reported?.revision ?? "Немає підтвердження"}
                        </dd>
                      </div>
                      <div>
                        <dt>Межі установки</dt>
                        <dd>
                          {data.desired.manifest.frequency_limits.min_hz}–
                          {data.desired.manifest.frequency_limits.max_hz} Гц
                        </dd>
                      </div>
                      <div>
                        <dt>Прошивка контролера</dt>
                        <dd>{data.firmware_version || "Невідома"}</dd>
                      </div>
                      <div>
                        <dt>Збережено</dt>
                        <dd>{formatSeen(data.desired.created_at, context.activeSite?.timezone ?? "UTC")}</dd>
                      </div>
                    </dl>
                    <details>
                      <summary>Ідентифікатори конфігурації</summary>
                      <dl className="overview-details">
                        <div>
                          <dt>Покоління прив’язки</dt>
                          <dd>{data.desired.manifest.binding_generation}</dd>
                        </div>
                        <div>
                          <dt>Збережений hash</dt>
                          <dd>{data.desired.configuration_hash}</dd>
                        </div>
                        <div>
                          <dt>Повідомлений hash</dt>
                          <dd>{data.reported?.configuration_hash ?? "Не отримано"}</dd>
                        </div>
                      </dl>
                    </details>
                  </section>
                )}
              </>
            )
          )}
          {knownControllerId && (
            <ControllerLifecycle context={context} controllerId={knownControllerId} onSaved={query.refresh} />
          )}
        </div>
      )}
    </Card>
  );
}
