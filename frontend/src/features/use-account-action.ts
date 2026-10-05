"use client";
import { useRef, useState } from "react";
import { apiErrorDisplayMessage } from "@/lib/api";

/** Serialize explicit account actions; never retry writes automatically. */
export function useAccountAction(onSuccess?: () => void) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      onSuccess?.();
    } catch (cause) {
      setError(apiErrorDisplayMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run, fail: setError };
}
