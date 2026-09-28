"use client";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { PollingBudget } from "@/lib/api/polling-policy";

export function usePanelQuery<T>({ queryKey, enabled = true, intervalMs, queryFn, pollWhile }: { queryKey: QueryKey; enabled?: boolean; intervalMs: number; pollWhile?: (data: T) => boolean; queryFn: (signal: AbortSignal) => Promise<T> }) {
  const client = useQueryClient();
  const hash = JSON.stringify(queryKey);
  const key = useMemo(() => JSON.parse(hash) as QueryKey, [hash]);
  const budget = useMemo(() => new PollingBudget(hash), [hash]);
  const [active, setActive] = useState(false);
  const manual = useRef(false);
  useEffect(() => {
    const update = () => {
      const available = document.visibilityState !== "hidden" && navigator.onLine;
      setActive(available);
      if (!available) void client.cancelQueries({ queryKey: key, exact: true });
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update); window.removeEventListener("offline", update);
    };
  }, [client, key]);
  const query = useQuery<T, Error>({
    queryKey: key, enabled: (current) => enabled && active && (current.state.data === undefined || (intervalMs > 0 && (!pollWhile || pollWhile(current.state.data)))), gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    refetchIntervalInBackground: false,
    refetchInterval: (current) => enabled && active && (current.state.data === undefined || !pollWhile || pollWhile(current.state.data)) ? budget.interval(intervalMs) : false,
    queryFn: async ({ signal }) => {
      const explicit = manual.current; manual.current = false;
      if (budget.error && (budget.blocked(explicit) || (!explicit && budget.interval(intervalMs || 30000) === false))) throw budget.error;
      try { const result = await queryFn(signal); budget.success(); return result; }
      catch (error) { if (!signal.aborted) budget.failure(error, intervalMs || 30000); throw error; }
    },
  });
  const refresh = () => {
    if (!enabled || !active || client.isFetching({ queryKey: key, exact: true }) || budget.blocked(true)) return;
    manual.current = true;
    void query.refetch({ cancelRefetch: false });
  };
  return { ...query, refresh, active };
}
