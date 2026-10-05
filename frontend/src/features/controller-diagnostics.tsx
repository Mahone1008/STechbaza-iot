import { Card, StatusBadge } from "@/components/ui";
import { resetReasonLabels, stopReasonLabels, transportLabels, uptimeText, type ControllerDiagnostics as Diagnostics } from "@/lib/api/diagnostics";
import { formatSeen } from "@/lib/api/inventory";
import { qualityLabels, type Quality } from "@/lib/api/overview";

export function ControllerDiagnostics({ data, quality, previousSession, timezone }: {
  data: Diagnostics | null; quality: Quality; previousSession: boolean; timezone: string;
}) {
  if (!data) return <Card title="Діагностика контролера"><p>Розширена діагностика ще не надходила від контролера.</p></Card>;
  const stop = data.last_stop;
  const signal = data.connection.signal;
  return <Card title="Діагностика контролера" description="Дані останнього отриманого зразка. Час роботи відраховується від запуску контролера.">
    <StatusBadge tone={quality === "fresh" ? "success" : "warning"}>{qualityLabels[quality]}</StatusBadge>
    {quality !== "fresh" && <p role="status">{previousSession ? "Діагностика попереднього запуску контролера; очікуємо нові дані." : "Остання відома діагностика; поточний стан не підтверджено."}</p>}
    <dl className="overview-details">
      <div><dt>Прошивка</dt><dd>{data.firmware_version}</dd></div>
      <div><dt>Час роботи на момент вимірювання</dt><dd>{uptimeText(data.uptime_ms)}</dd></div>
      <div><dt>Причина запуску контролера</dt><dd>{resetReasonLabels[data.reset_reason]}</dd></div>
      <div><dt>Канал зв’язку</dt><dd>{transportLabels[data.connection.transport]}</dd></div>
      {(["wifi", "cellular"] as const).some((transport) => transport === data.connection.transport) && <div><dt>Радіосигнал</dt><dd>{signal ? `${signal.metric.toUpperCase()}: ${signal.dbm} dBm` : "Немає вимірювання"}</dd></div>}
      <div><dt>Останній запит зупинки в цьому запуску</dt><dd>{stop ? stopReasonLabels[stop.reason] : "Не зафіксовано"}</dd></div>
      {stop && <>
        <div><dt>Час запиту зупинки</dt><dd>{stop.requested_at ? formatSeen(stop.requested_at, timezone) : "Точний час події невідомий"}<div className="table-secondary">Від запуску: {uptimeText(stop.uptime_ms)}</div></dd></div>
        <div><dt>Результат цього запиту</dt><dd>{stop.confirmed ? "STOP і 0 Гц підтверджено читанням частотника" : "Зупинку ще не підтверджено"}</dd></div>
      </>}
    </dl>
    <p className="help-copy">Запис описує останній запит контролера на зупинку; після нового пуску він залишається історичним. Поточний стан роботи показано на панелі пристрою. Підтвердження за регістрами частотника не є незалежним вимірюванням обертання двигуна.</p>
  </Card>;
}
