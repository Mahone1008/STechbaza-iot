import type { ReactNode } from "react";

export function RefreshSettings({
  children,
  label = "Оновлення даних",
  error = false,
}: {
  children: ReactNode;
  label?: string;
  error?: boolean;
}) {
  return (
    <details className="refresh-settings" open={error || undefined}>
      <summary>{label}</summary>
      <div className="ui-row refresh-settings-content">{children}</div>
    </details>
  );
}
