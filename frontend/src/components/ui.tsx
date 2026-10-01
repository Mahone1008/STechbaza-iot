import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "default" | "small";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

export function Button({ className, variant = "secondary", size = "default", fullWidth = false, type = "button", ...props }: ButtonProps) {
  return (
    <button className={classNames("button", `button-${variant}`, size === "small" && "button-small", fullWidth && "button-full", className)} type={type} {...props} />
  );
}

type CardProps = { children: ReactNode; className?: string; title?: string; description?: string; actions?: ReactNode };

export function Card({ children, className, title, description, actions }: CardProps) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section className={classNames("card", className)}>
      {hasHeader ? (
        <header className="card-header">
          <div>{title ? <h2 className="card-title">{title}</h2> : null}{description ? <p className="card-description">{description}</p> : null}</div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-badge status-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}

type FieldBaseProps = { label: string; hint?: string; error?: string };
type TextFieldProps = FieldBaseProps & InputHTMLAttributes<HTMLInputElement>;

export function TextField({ label, hint, error, id, className, ...props }: TextFieldProps) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9а-яіїє]+/giu, "-")}`;
  const descriptionId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field-label" id={`${fieldId}-label`}>{label}</span>
      <input className={classNames("input", className)} id={fieldId} aria-labelledby={`${fieldId}-label`} aria-invalid={Boolean(error)} aria-describedby={descriptionId} {...props} />
      {error ? <span className="field-error" id={descriptionId}>{error}</span> : hint ? <span className="field-hint" id={descriptionId}>{hint}</span> : null}
    </label>
  );
}

type SelectFieldProps = FieldBaseProps & SelectHTMLAttributes<HTMLSelectElement>;
export function SelectField({ label, hint, error, id, className, children, ...props }: SelectFieldProps) {
  const fieldId = id ?? `select-${label.toLowerCase().replace(/[^a-z0-9а-яіїє]+/giu, "-")}`;
  const descriptionId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field-label" id={`${fieldId}-label`}>{label}</span>
      <select className={classNames("select", className)} id={fieldId} aria-labelledby={`${fieldId}-label`} aria-invalid={Boolean(error)} aria-describedby={descriptionId} {...props}>{children}</select>
      {error ? <span className="field-error" id={descriptionId}>{error}</span> : hint ? <span className="field-hint" id={descriptionId}>{hint}</span> : null}
    </label>
  );
}

export type TableColumn<T> = { key: string; header: string; render: (row: T) => ReactNode };
type DataTableProps<T extends { id: string }> = { rows: readonly T[]; columns: readonly TableColumn<T>[]; emptyMessage?: string; caption: string };

export function DataTable<T extends { id: string }>({ rows, columns, emptyMessage = "Немає даних для відображення.", caption }: DataTableProps<T>) {
  return (
    <div className="table-shell"><div className="table-scroll" tabIndex={0} role="region" aria-label={`${caption}: прокручувана таблиця`}><table className="data-table">
      <caption className="visually-hidden">{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row) => <tr key={row.id}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>) : <tr><td className="table-empty" colSpan={columns.length}>{emptyMessage}</td></tr>}</tbody>
    </table></div></div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header"><div className="page-header-copy">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 className="page-title">{title}</h1>
      {description ? <p className="page-description">{description}</p> : null}
    </div>{actions ? <div className="page-actions">{actions}</div> : null}</header>
  );
}

export function MetricCard({ label, value, unit, meta, status }: { label: string; value: string; unit: string; meta: string; status?: ReactNode }) {
  return (
    <article className="card metric-card"><div className="metric-head"><span className="metric-label">{label}</span>{status}</div>
      <div className="metric-value"><strong>{value}</strong><span>{unit}</span></div><div className="metric-meta">{meta}</div>
    </article>
  );
}
