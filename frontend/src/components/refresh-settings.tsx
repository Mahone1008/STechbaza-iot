"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function RefreshSettings({
  children,
  label = "Оновлення даних",
  error = false,
}: {
  children: ReactNode;
  label?: string;
  error?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (error && details.current) details.current.open = true;
  }, [error]);
  return (
    <details className="refresh-settings" ref={details}>
      <summary>{label}</summary>
      <div className="ui-row refresh-settings-content">{children}</div>
    </details>
  );
}
