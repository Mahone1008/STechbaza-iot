"use client";
import { useEffect, useRef, useState } from "react";
import { apiErrorDisplayMessage, isApiError } from "@/lib/api";
import { parseReadReceipt, type Notification } from "@/lib/api/notifications";
import { useAuthSession } from "./auth-session";

type Outcome = { denied: boolean; error?: unknown; message: string; checkedRead: number; retryAt: number };
const available = () => navigator.onLine && document.visibilityState !== "hidden";

export function useNotificationRead({ item, read, active, refresh }: {
  item: Notification | null; read: number; active: boolean; refresh: () => void;
}) {
  const { authorizedRequest } = useAuthSession();
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (!available()) pending.current?.abort(); };
    window.addEventListener("offline", update); document.addEventListener("visibilitychange", update);
    return () => { mounted.current = false; pending.current?.abort(); window.removeEventListener("offline", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const retryAt = outcome?.retryAt ?? 0;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => { const time = Date.now(); setNow(time); if (time >= retryAt) window.clearInterval(timer); }, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const needsCheck = !!outcome && read <= outcome.checkedRead;
  const waiting = now < retryAt;
  const canRead = !!item && !item.read_at && active && !busy && !needsCheck && !waiting && !outcome?.denied;

  async function markRead() {
    if (!canRead || !item || pending.current || !available()) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setOutcome(null);
    try {
      const raw = await authorizedRequest({ path: `/api/v1/notifications/${item.id}/read`, method: "POST", signal: controller.signal, timeoutMs: 10_000, retryOnUnauthorized: false });
      parseReadReceipt(raw, item.id);
      controller.signal.throwIfAborted();
      if (!mounted.current) return;
      setOutcome({ denied: false, message: "Прочитання збережено. Перечитуємо повідомлення.", checkedRead: read, retryAt: 0 });
      refresh();
    } catch (error) {
      if (!mounted.current) return;
      const denied = isApiError(error) && ["unauthorized", "forbidden", "not-found"].includes(error.kind);
      setOutcome({ denied, error, checkedRead: read,
        retryAt: isApiError(error) && error.kind === "rate-limited" ? Date.now() + (error.retryAfterSeconds ?? 30) * 1000 : 0,
        message: denied ? apiErrorDisplayMessage(error) : "Результат прочитання невідомий. Спочатку перевірте повідомлення. " + apiErrorDisplayMessage(error),
      });
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, outcome, needsCheck, waiting, canRead, markRead };
}
