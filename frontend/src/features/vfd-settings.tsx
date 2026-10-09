"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, TextField } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuthSession } from "./auth-session";
import { usePanelActivity } from "./panel-activity";
import { usePanelQuery } from "./use-panel-query";
import { useElapsedSeconds } from "./use-elapsed-seconds";
import type { ReadyAccessSnapshot } from "./access-context";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { commandPending, parseCommandReceipt, statusLabels, type Command, type CommandInput } from "@/lib/api/commands";
import { effectiveQuality, parseOverview, type Overview } from "@/lib/api/overview";
import { sameEquipmentTarget } from "@/lib/api/equipment";
import { parameterWord, sourceLabel } from "@/lib/api/vfd-settings";

type Props = {
  context: ReadyAccessSnapshot;
  overview: Overview | null;
  receivedAt: number;
  onCreated: (id: string) => void;
  onRefresh?: () => void;
  onBusy?: (busy: boolean) => void;
};
type Change = { input: CommandInput; title: string; description: string };

function useSettingsChange(props: Props) {
  const { context, overview, receivedAt, onCreated, onRefresh, onBusy } = props;
  const { authorizedRequest } = useAuthSession();
  const sectionActive = usePanelActivity();
  const active = useRef(sectionActive);
  useEffect(() => {
    active.current = sectionActive;
  }, [sectionActive]);
  const elapsed = useElapsedSeconds(receivedAt);
  const [dialog, setDialog] = useState<Change | null>(null);
  const [intent, setIntent] = useState<CommandInput | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const running = useRef(false);
  const notifiedCommand = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const device = context.activeDevice!;
  const query = usePanelQuery<Command | null>({
    queryKey: ["vfd-setting-command", context.scope, device.id, intent?.request_id],
    enabled: !!intent && context.access.permissions.includes("command.read"),
    intervalMs: 5000,
    pollWhile: (command) => command === null || commandPending(command) || command.status === "result_unknown",
    queryFn: async (signal) => {
      try {
        return parseCommandReceipt(
          await authorizedRequest({
            path: `/api/v1/devices/${device.id}/commands/by-request/${intent!.request_id}`,
            signal,
          }),
          device.id,
          context.activeOrganization.id,
          context.scope.userId,
          intent!,
        );
      } catch (error) {
        // The receipt may not exist yet while an uncertain POST is still completing.
        // Continue GET polling; never replay the mutation to recover its response.
        if (isApiError(error) && error.kind === "not-found") return null;
        throw error;
      }
    },
  });
  const settled = !!query.data && !commandPending(query.data);
  const canAct =
    !!overview &&
    sectionActive &&
    query.active &&
    overview.availability.online &&
    effectiveQuality(overview.freshness.status, overview.freshness, elapsed) === "fresh" &&
    !!overview.diagnostics?.vfd_settings?.ready &&
    context.access.permissions.includes("command.execute");
  const refresh = useRef(onRefresh);
  const created = useRef(onCreated);
  useEffect(() => {
    refresh.current = onRefresh;
    created.current = onCreated;
  }, [onRefresh, onCreated]);
  useEffect(() => {
    if (query.data && notifiedCommand.current !== query.data.id) {
      notifiedCommand.current = query.data.id;
      created.current(query.data.id);
    }
  }, [query.data]);
  useEffect(() => {
    onBusy?.(sending || (!!intent && !settled));
  }, [sending, intent, settled, onBusy]);
  useEffect(() => {
    if (settled) refresh.current?.();
  }, [settled, query.data?.status]);
  useEffect(() => () => abort.current?.abort(), []);
  const busy = sending || (!!intent && !settled);
  const open = (
    payload: NonNullable<CommandInput["payload"]>,
    parameter: boolean,
    title: string,
    description: string,
  ) => {
    if (!canAct || busy || !overview) return;
    setDialog({
      title,
      description,
      input: {
        command_type: parameter ? "vfd.parameter.set" : "vfd.source.set",
        request_id: crypto.randomUUID(),
        ttl_seconds: 30,
        payload,
        equipment_target: overview.equipmentTarget ?? null,
      },
    });
  };
  const send = async () => {
    if (!dialog || !canAct || busy || running.current) return;
    const input = dialog.input;
    running.current = true;
    setSending(true);
    setNotice(null);
    abort.current = new AbortController();
    let attempted = false;
    try {
      const current = parseOverview(
        await authorizedRequest({
          path: `/api/v1/devices/${device.id}/overview`,
          signal: abort.current.signal,
        }),
        device,
        context.activeOrganization.id,
      );
      const settings = current.diagnostics?.vfd_settings;
      const source = input.command_type === "vfd.source.set";
      if (
        !active.current ||
        !navigator.onLine ||
        document.visibilityState === "hidden" ||
        !settings?.ready ||
        current.freshness.status !== "fresh" ||
        !current.availability.online ||
        !sameEquipmentTarget(current.equipmentTarget, input.equipment_target) ||
        (source
          ? settings.run_source !== input.payload?.expected_run_source ||
            settings.frequency_source !== input.payload?.expected_frequency_source
          : settings.parameters[input.payload?.code as "F0.10" | "F0.11"] !== input.payload?.expected_raw)
      )
        throw new Error("Стан змінився. Оновіть показання та підтвердьте нову дію.");
      setIntent(input);
      attempted = true;
      const command = parseCommandReceipt(
        await authorizedRequest({
          method: "POST",
          path: `/api/v1/devices/${device.id}/commands`,
          body: input,
          signal: abort.current.signal,
        }),
        device.id,
        context.activeOrganization.id,
        context.scope.userId,
        input,
      );
      if (notifiedCommand.current !== command.id) {
        notifiedCommand.current = command.id;
        onCreated(command.id);
      }
      setNotice("Команду прийнято. Очікуємо перевірку налаштувань контролером.");
      query.refresh();
    } catch (error) {
      const definite =
        isApiError(error) && ["validation", "forbidden", "not-found", "conflict", "unauthorized"].includes(error.kind);
      if (!attempted || definite) {
        setIntent(null);
        setNotice(error instanceof Error ? error.message : apiErrorDisplayMessage(error));
      } else
        setNotice("Доставку не підтверджено. Автоматично перевіряємо статус команди. Повторний запис не надсилається.");
    } finally {
      running.current = false;
      setSending(false);
    }
  };
  const feedback = (
    <>
      {notice && !settled && <p role="status">{notice}</p>}
      {query.data && <p role="status">{statusLabels[query.data.status]}</p>}
      {query.isError && <p role="alert">{apiErrorDisplayMessage(query.error)}</p>}
      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title ?? "Підтвердити зміну"}
        description={`${device.name} · ${dialog?.description ?? ""}`}
        confirmLabel="Підтвердити зміну"
        confirmDisabled={!canAct || busy}
        onConfirm={() => void send()}
        onClose={() => setDialog(null)}
      >
        <p>Двигун має бути зупинений. Зміна сама не запускає його. Перед записом вимкніть активні розклади.</p>
      </ConfirmDialog>
    </>
  );
  return { canAct, busy, open, feedback };
}

export function VfdSourceControl(props: Props) {
  const change = useSettingsChange(props);
  const settings = props.overview?.diagnostics?.vfd_settings;
  const elapsed = useElapsedSeconds(props.receivedAt);
  const fresh =
    !!props.overview &&
    effectiveQuality(props.overview.freshness.status, props.overview.freshness, elapsed) === "fresh";
  if (!settings) return null;
  const canSwitch = props.overview?.allowedCommands.includes("vfd.source.set");
  return (
    <section className="vfd-source-control" aria-label="Джерело керування">
      <p>
        <strong>Джерело керування:</strong>{" "}
        {fresh ? sourceLabel(settings) : "Не підтверджено · потрібні свіжі показання"}
      </p>
      {fresh && settings.run_source === 0 && (
        <p className="help-copy">
          У місцевому режимі зупиняйте двигун на панелі частотника або установці. Зупинка із сайту потребує
          підтвердження контролера.
        </p>
      )}
      {canSwitch && (
        <div className="ui-row">
          {(["local", "remote"] as const).map((source) => (
            <Button
              key={source}
              size="small"
              disabled={
                !change.canAct ||
                change.busy ||
                (source === "remote"
                  ? settings.run_source === 2 && settings.frequency_source === 6
                  : settings.run_source === 0 && settings.frequency_source === 0)
              }
              onClick={() =>
                change.open(
                  {
                    source,
                    expected_run_source: settings.run_source!,
                    expected_frequency_source: settings.frequency_source!,
                  },
                  false,
                  source === "local" ? "Увімкнути місцеве керування" : "Увімкнути дистанційне керування",
                  source === "local"
                    ? "Запуск і зупинка — кнопками панелі частотника, частота — її крутилкою."
                    : "Запуск та частота задаватимуться із сайту. Задана дистанційна частота спочатку стане 0 Гц.",
                )
              }
            >
              {source === "local" ? "Місцеве керування" : "Дистанційне керування"}
            </Button>
          ))}
        </div>
      )}
      {canSwitch && !change.canAct && (
        <p className="help-copy">
          Перемикання потребує свіжих показань, зупиненого двигуна й дозволу контролера. Керування клемами перемикається
          на установці.
        </p>
      )}
      {change.feedback}
    </section>
  );
}

export function VfdServiceParameters(props: Props) {
  const change = useSettingsChange(props);
  const [values, setValues] = useState<Record<string, string>>({});
  if (!["superadmin", "service_admin"].includes(props.context.access.platform_role)) return null;
  const settings = props.overview?.diagnostics?.vfd_settings;
  const allowed = props.overview?.allowedCommands.includes("vfd.parameter.set");
  return (
    <Card
      title="Сервісні параметри частотника"
      description="SU600 · перед записом контролер перевіряє зупинку та перечитує поточне значення."
    >
      {!settings ? (
        <p>Потрібна прошивка контролера з підтримкою налаштувань SU600.</p>
      ) : (
        <>
          <p className="help-copy">
            Час розгону та гальмування впливає на переходи частоти й тривалість зупинки. Діапазон: 0,1–999,9 с. Розклади
            перед змінами мають бути вимкнені.
          </p>
          {(
            [
              ["F0.10", "Час розгону"],
              ["F0.11", "Час гальмування"],
            ] as const
          ).map(([code, label]) => {
            const actual = settings.parameters[code];
            const value = parameterWord(values[code] ?? "");
            return (
              <section className="vfd-parameter" key={code}>
                <h3>
                  {code} · {label}
                </h3>
                <p>Останнє прочитане значення: {typeof actual === "number" ? `${actual / 10} с` : "не отримано"}.</p>
                <TextField
                  label={`${label}, с`}
                  inputMode="decimal"
                  value={values[code] ?? ""}
                  onChange={(event) => setValues({ ...values, [code]: event.target.value })}
                  disabled={change.busy || !allowed}
                />
                <Button
                  disabled={
                    !allowed ||
                    !change.canAct ||
                    change.busy ||
                    typeof actual !== "number" ||
                    value === null ||
                    value === actual
                  }
                  onClick={() =>
                    change.open(
                      { code, expected_raw: actual!, value_raw: value! },
                      true,
                      `Змінити ${code}`,
                      `${label}: ${actual! / 10} с → ${value! / 10} с. Після запису контролер перечитає параметр.`,
                    )
                  }
                >
                  Застосувати {code}
                </Button>
              </section>
            );
          })}
          <p className="help-copy">
            Параметри захисту, двигуна, адреси шини, скидання й автоналаштування змінюються за окремою сервісною
            процедурою.
          </p>
        </>
      )}
      <Button disabled={!props.onRefresh} onClick={props.onRefresh}>
        Оновити показання параметрів
      </Button>
      {change.feedback}
    </Card>
  );
}
