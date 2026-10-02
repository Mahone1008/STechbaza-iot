"use client";
import { useState } from "react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useAuthSession } from "@/features/auth-session";
import type { ReadyAccessSnapshot } from "@/features/access-context";
import { usePanelQuery } from "@/features/use-panel-query";
import { apiErrorDisplayMessage } from "@/lib/api";
import { equipmentStateLabels, parseEquipmentPassport } from "@/lib/api/equipment";
import { formatSeen } from "@/lib/api/inventory";

export function EquipmentPassportPanel({ context }: { context: ReadyAccessSnapshot }) {
  const device = context.activeDevice!;
  const [open, setOpen] = useState(false);
  const { authorizedRequest } = useAuthSession();
  const query = usePanelQuery({
    queryKey: ["equipment-passport", context.scope, context.activeOrganization.id, device.id],
    enabled: open, intervalMs: 0,
    queryFn: async (signal) => parseEquipmentPassport(await authorizedRequest<unknown>({ path: `/api/v1/devices/${device.id}/equipment`, signal }), device),
  });
  const data = query.data;
  return <Card title="Обладнання">
    <Button aria-expanded={open} aria-controls="equipment-passport" onClick={() => setOpen(!open)}>{open ? "Згорнути паспорт" : "Паспорт обладнання"}</Button>
    {open && <div id="equipment-passport" className="equipment-passport">
      <div className="ui-row"><Button disabled={!query.active || query.isFetching} onClick={query.refresh}>Оновити паспорт</Button></div>
      {query.isPending ? <p role="status">Завантаження паспорта…</p> : query.isError ? <p role="alert">{apiErrorDisplayMessage(query.error)}</p> : data && <>
        <StatusBadge tone={data.configuration_state === "verified" ? "success" : data.configuration_state === "legacy" ? "neutral" : "warning"}>{equipmentStateLabels[data.configuration_state]}</StatusBadge>
        <p className="help-copy">Паспорт завантажується на запит. Реєстрація модуля не вмикає керування ним.</p>
        {data.modules.length === 0 ? <p>Підключені модулі ще не внесено в паспорт. Чинне стендове підключення збережено.</p> : data.modules.map((module) => <section key={module.id} className="equipment-module" aria-label={module.name}>
          <h3>{module.name}</h3>
          <dl className="overview-details">
            <div><dt>Установка</dt><dd>{data.installations.find((item) => item.id === module.installation_id)?.name}</dd></div>
            <div><dt>Модель</dt><dd>{module.manufacturer} {module.model}</dd></div>
            <div><dt>Серія · місце підключення</dt><dd>{module.series} · {module.slot}</dd></div>
            <div><dt>Серійний номер</dt><dd>{module.serial_number || "Не зазначено"}</dd></div>
            <div><dt>Ревізія обладнання / ПЗ</dt><dd>{module.hardware_revision || "Не зазначено"} / {module.software_revision || "Не зазначено"}</dd></div>
            {module.motor && <div><dt>Номінальна частота двигуна</dt><dd>{module.motor.rated_frequency_hz} Гц</dd></div>}
          </dl>
        </section>)}
        {data.desired && <section aria-label="Конфігурація обладнання">
          <h3>Узгодження з контролером</h3>
          <dl className="overview-details">
            <div><dt>Профіль</dt><dd>{data.desired.manifest.profile_id} · v{data.desired.manifest.profile_version}</dd></div>
            <div><dt>Збережена / повідомлена ревізія</dt><dd>{data.desired.manifest.revision} / {data.reported?.revision ?? "Немає підтвердження"}</dd></div>
            <div><dt>Межі установки</dt><dd>{data.desired.manifest.frequency_limits.min_hz}–{data.desired.manifest.frequency_limits.max_hz} Гц</dd></div>
            <div><dt>Прошивка контролера</dt><dd>{data.firmware_version || "Невідома"}</dd></div>
            <div><dt>Збережено</dt><dd>{formatSeen(data.desired.created_at, context.activeSite?.timezone ?? "UTC")}</dd></div>
          </dl>
          <details><summary>Ідентифікатори конфігурації</summary><dl className="overview-details">
            <div><dt>Покоління прив’язки</dt><dd>{data.desired.manifest.binding_generation}</dd></div>
            <div><dt>Збережений hash</dt><dd>{data.desired.configuration_hash}</dd></div>
            <div><dt>Повідомлений hash</dt><dd>{data.reported?.configuration_hash ?? "Не отримано"}</dd></div>
          </dl></details>
        </section>}
        <p className="help-copy">Зараз керування реалізовано для стендового SU600A-5RG1-B. Решта серій SUSWE внесені до каталогу за інструкціями та потребують окремих драйверів і перевірки на обладнанні.</p>
      </>}
    </div>}
  </Card>;
}
