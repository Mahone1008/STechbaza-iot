"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { controlModeLabels, parseControlMode, type ControlMode, type ControlModeInput } from "@/lib/api/control-mode";
import { formatScheduleTime } from "@/lib/api/schedules";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";
import { usePanelActivity } from "./panel-activity";

export function ControlModePanel({
  context,
  data,
  blocked = false,
  onChanged,
  onBusy,
  onSchedules,
}: {
  context: ReadyAccessSnapshot;
  data: ControlMode | null;
  blocked?: boolean;
  onChanged: () => void;
  onBusy?: (busy: boolean) => void;
  onSchedules?: (() => void) | undefined;
}) {
  const active = usePanelActivity();
  const { authorizedRequest } = useAuthSession();
  const [dialog, setDialog] = useState<ControlModeInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<ControlModeInput | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const deviceId = context.activeDevice!.id;
  const canChange = context.access.permissions.includes("command.execute");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) pending.current?.abort();
  }, [active]);
  useEffect(() => {
    onBusy?.(busy || !!uncertain);
  }, [busy, uncertain, onBusy]);

  async function save(input: ControlModeInput) {
    if (pending.current || !active || !canChange || !navigator.onLine || document.visibilityState === "hidden") return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice(null);
    try {
      const raw = await authorizedRequest<unknown>({
        path: `/api/v1/devices/${deviceId}/control-mode`,
        method: "PATCH",
        body: input,
        signal: controller.signal,
        timeoutMs: 10_000,
        retryOnUnauthorized: false,
      });
      const saved = parseControlMode(raw, deviceId);
      if (
        !saved ||
        saved.mode !== input.mode ||
        saved.revision < input.expected_revision ||
        saved.revision > input.expected_revision + 1
      )
        throw new Error("Відповідь потребує перевірки. Оновіть панель.");
      if (!mounted.current) return;
      setUncertain(null);
      setNotice("Вибір збережено. Оновлюємо стан панелі.");
      onChanged();
    } catch (error) {
      if (!mounted.current) return;
      const rejected =
        isApiError(error) && ["unauthorized", "forbidden", "not-found", "conflict", "validation"].includes(error.kind);
      setUncertain(rejected ? null : input);
      setNotice(
        isApiError(error)
          ? apiErrorDisplayMessage(error)
          : error instanceof Error
            ? error.message
            : "Не вдалося зберегти режим.",
      );
      onChanged();
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  if (!data) return null;
  return (
    <section className="control-mode-panel" aria-label="Режим запуску">
      <div className="control-mode-heading">
        <h3>Режим запуску</h3>
        <strong>{controlModeLabels[data.mode]}</strong>
      </div>
      <p>
        {data.mode === "manual"
          ? "Автоматичні запуски призупинено. Ви запускаєте й зупиняєте насос кнопками на панелі."
          : "Насос працює у збережений час. Ручний запуск або STOP увімкне ручне керування та призупинить майбутні запуски."}
      </p>
      {canChange && (
        <div className="control-mode-options">
          {(["manual", "schedule"] as const).map((mode) => (
            <Button
              key={mode}
              variant={data.mode === mode ? "primary" : "secondary"}
              aria-pressed={data.mode === mode}
              disabled={
                !active ||
                blocked ||
                busy ||
                !!uncertain ||
                data.mode === mode ||
                (mode === "schedule" && !data.next_start_at)
              }
              onClick={() => setDialog({ request_id: crypto.randomUUID(), mode, expected_revision: data.revision })}
            >
              {controlModeLabels[mode]}
            </Button>
          ))}
        </div>
      )}
      {data.mode === "schedule" && data.next_start_at && (
        <p className="help-copy">
          Найближчий запланований запуск:{" "}
          {formatScheduleTime(data.next_start_at, context.activeSite?.timezone ?? "UTC")}.
        </p>
      )}
      {data.mode === "manual" && !data.next_start_at && (
        <p className="help-copy">Щоб працювати автоматично, збережіть і увімкніть розклад із майбутнім запуском.</p>
      )}
      {onSchedules && (
        <Button variant="secondary" onClick={onSchedules}>
          Налаштувати розклади
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
      {uncertain && (
        <div className="notice notice-warning" role="alert">
          <p>Збереження режиму не підтверджено. Повторна перевірка використовує той самий запит.</p>
          <Button disabled={busy || blocked || !active} onClick={() => void save(uncertain)}>
            Перевірити збереження режиму
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!dialog}
        title={dialog ? controlModeLabels[dialog.mode] : "Режим запуску"}
        description={
          dialog?.mode === "manual"
            ? "Майбутні автоматичні запуски буде призупинено. Розклади збережуться. Поточний цикл зупиняється окремою кнопкою STOP."
            : "Будуть виконуватися лише майбутні запуски увімкнених розкладів. Пропущені запуски не відновлюються."
        }
        confirmLabel="Зберегти режим"
        confirmDisabled={blocked || busy || !!uncertain || !active || dialog?.expected_revision !== data.revision}
        onConfirm={() => {
          if (dialog) void save(dialog);
        }}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}
