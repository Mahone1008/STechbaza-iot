"use client";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui";
import { usePanelActivity } from "./panel-activity";

type Action = { refresh: () => void; disabled: boolean; error: boolean };
const Registration = createContext<((id: string, action: Action) => () => void) | null>(null);
const Actions = createContext<ReadonlyMap<string, Action>>(new Map());

/** A page owns its refresh actions; hidden tabs never contribute requests. */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReadonlyMap<string, Action>>(() => new Map());
  const register = useCallback((id: string, action: Action) => {
    setActions((previous) => new Map(previous).set(id, action));
    return () =>
      setActions((previous) => {
        if (previous.get(id) !== action) return previous;
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
  }, []);
  return (
    <Registration.Provider value={register}>
      <Actions.Provider value={actions}>{children}</Actions.Provider>
    </Registration.Provider>
  );
}

/** Register the existing query refresh, preserving its permissions and retry budget. */
export function RefreshAction({
  onRefresh,
  disabled = false,
  error = false,
  available = true,
}: {
  onRefresh: () => void;
  disabled?: boolean;
  error?: boolean;
  available?: boolean;
}) {
  const register = useContext(Registration);
  const active = usePanelActivity();
  const id = useId();
  const latest = useRef({ onRefresh, disabled, active, available });
  useLayoutEffect(() => {
    latest.current = { onRefresh, disabled, active, available };
  });
  useLayoutEffect(() => {
    if (!register || !active || !available) return;
    return register(id, {
      disabled,
      error,
      refresh: () => {
        const current = latest.current;
        if (current.active && current.available && !current.disabled) current.onRefresh();
      },
    });
  }, [register, id, active, available, disabled, error]);
  return null;
}

export function RefreshButton({ label = "Оновити дані" }: { label?: string }) {
  const actions = [...useContext(Actions).values()];
  return (
    <Button
      disabled={actions.length === 0 || actions.some((action) => action.disabled)}
      onClick={() => {
        if (actions.some((action) => action.disabled)) return;
        for (const action of actions) action.refresh();
      }}
    >
      {label}
    </Button>
  );
}

export function DisplaySettings({ children, error = false }: { children: ReactNode; error?: boolean }) {
  const actions = useContext(Actions);
  const hasError = error || [...actions.values()].some((action) => action.error);
  const details = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (hasError && details.current) details.current.open = true;
  }, [hasError]);
  return (
    <details className="customer-disclosure panel-display-settings" ref={details}>
      <summary>Налаштування відображення</summary>
      <div className="panel-refresh-controls">{children}</div>
    </details>
  );
}
