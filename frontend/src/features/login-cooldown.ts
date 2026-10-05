"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { apiConfig } from "@/lib/api/config";

// Only the server's retry deadline is stored; credentials and tokens never go here.
const storageKey = `kerumo.login-cooldown:${apiConfig.baseUrl}`;
const changeEvent = "kerumo-login-cooldown-change";
let memoryDeadline: number | null = null;

function readDeadline(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(window.localStorage.getItem(storageKey));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return memoryDeadline;
  }
}

function writeDeadline(value: number | null): void {
  memoryDeadline = value;
  try {
    if (value === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Storage may be disabled; the API still enforces its database limit.
  }
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, callback);
  };
}

export function useLoginCooldown() {
  const deadline = useSyncExternalStore(subscribe, readDeadline, () => null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const now = Date.now();
      setClock(now);
      // A second tab may have received a newer deadline in the meantime.
      const current = readDeadline();
      if (current !== null && current <= now) writeDeadline(null);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [deadline]);

  return {
    retrySeconds: deadline === null ? 0 : Math.max(0, Math.ceil((deadline - clock) / 1_000)),
    block: (seconds: number) => {
      const now = Date.now();
      setClock(now);
      writeDeadline(Math.max(readDeadline() ?? 0, now + seconds * 1_000));
    },
  };
}
