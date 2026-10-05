"use client";
import { useEffect, useRef, useState } from "react";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { parseAcknowledgement, type Alarm } from "@/lib/api/alarms";
import type { ReadyAccessSnapshot } from "./access-context";
import { useAuthSession } from "./auth-session";

type Outcome = { kind: "confirmed" | "uncertain" | "conflict" | "denied"; message: string; error?: unknown; checkedRead: number; retryAt: number };
const browserAvailable = () => navigator.onLine && document.visibilityState !== "hidden";

export function useAlarmAcknowledgement({ context, alarm, read, active, refresh }: {
  context: ReadyAccessSnapshot; alarm: Alarm | null; read: number; active: boolean; refresh: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (!browserAvailable()) pending.current?.abort(); };
    window.addEventListener("offline", update); document.addEventListener("visibilitychange", update);
    return () => { mounted.current = false; pending.current?.abort(); window.removeEventListener("offline", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const retryAt = outcome?.retryAt ?? 0;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => { const time = Date.now(); setNow(time); if (time >= retryAt) window.clearInterval(timer); }, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const allowed = context.access.permissions.includes("alarm.acknowledge");
  const needsCheck = !!outcome && outcome.kind !== "confirmed" && read <= outcome.checkedRead;
  const waiting = !!outcome && now < outcome.retryAt;
  const canConfirm = allowed && active && !busy && !needsCheck && !waiting && outcome?.kind !== "denied" && alarm?.state === "active" && !alarm.acknowledged_at;

  async function confirm() {
    if (!canConfirm || !alarm || pending.current || !browserAvailable()) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setOutcome(null);
    try {
      const raw = await authorizedRequest({ path: `/api/v1/alarms/${alarm.id}/acknowledge`, method: "POST", signal: controller.signal, timeoutMs: 10_000, retryOnUnauthorized: false });
      parseAcknowledgement(raw, context.activeDevice!.id, alarm.id);
      controller.signal.throwIfAborted();
      if (!mounted.current) return;
      setOutcome({ kind: "confirmed", message: "Отримання аварії підтверджено. Оновлюємо її стан.", checkedRead: read, retryAt: 0 });
      refresh();
    } catch (error) {
      if (!mounted.current) return;
      const denied = isApiError(error) && ["unauthorized", "forbidden", "not-found"].includes(error.kind);
      const conflict = isApiError(error) && error.kind === "conflict";
      setOutcome({
        kind: denied ? "denied" : conflict ? "conflict" : "uncertain", error, checkedRead: read,
        retryAt: isApiError(error) && error.kind === "rate-limited" ? Date.now() + (error.retryAfterSeconds ?? 30) * 1000 : 0,
        message: denied ? apiErrorDisplayMessage(error) : conflict ? "Стан інциденту змінився до підтвердження. Перечитуємо його." : "Результат підтвердження невідомий. Перевірте стан перед повторною спробою. " + apiErrorDisplayMessage(error),
      });
      if (conflict) refresh();
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return { allowed, busy, outcome, needsCheck, waiting, canConfirm, confirm };
}
