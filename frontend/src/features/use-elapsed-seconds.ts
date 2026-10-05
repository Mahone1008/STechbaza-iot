"use client";
import { useEffect, useState } from "react";

/** Age a server snapshot even when polling is paused or set to manual. */
export function useElapsedSeconds(receivedAt: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const update = () => setNow(performance.now());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return Math.max(0, (now - receivedAt) / 1000);
}
