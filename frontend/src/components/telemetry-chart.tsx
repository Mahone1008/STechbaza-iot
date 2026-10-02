import { bucketLabels, type Series } from "@/lib/api/telemetry-series";
import { formatSeen } from "@/lib/api/inventory";

const numberFormatter = new Intl.NumberFormat("uk-UA", { maximumSignificantDigits: 8 });
const number = (value: number | null) => value === null ? "—" : numberFormatter.format(value);
export function TelemetryChart({ series, timezone }: { series: Series; timezone: string }) {
  const values = series.buckets.flatMap((b) => b.minimum === null ? [] : [b.minimum, b.maximum!]);
  const magnitude = Math.max(1, ...values.map(Math.abs));
  const low = values.length ? Math.min(...values.map((n) => n / magnitude)) : 0;
  const high = values.length ? Math.max(...values.map((n) => n / magnitude)) : 1;
  const y = (n: number) => high === low ? 120 : 220 - ((n / magnitude - low) / (high - low)) * 200;
  const x = (index: number) => 65 + ((index + 0.5) / series.buckets.length) * 710;
  const segments: string[] = []; let segment = "";
  for (let i = 0; i < series.buckets.length; i += 1) {
    const b = series.buckets[i]!;
    if (b.average === null) { if (segment) segments.push(segment); segment = ""; }
    else segment += `${segment ? " L" : "M"}${x(i)},${y(b.average)}`;
  }
  if (segment) segments.push(segment);
  return <>
    {series.sample_count === 0 ? <p role="status">За цей період немає валідних вимірювань.</p> : <svg className="telemetry-chart" viewBox="0 0 800 260" role="img" aria-label={`Історія ${series.metric}, ${series.unit}. Середнє та мінімум–максимум; розриви означають відсутність валідних даних.`}>
      <line x1="65" y1="220" x2="775" y2="220" stroke="currentColor" opacity="0.3" />
      <text x="60" y="20" textAnchor="end">{number(high * magnitude)}</text><text x="60" y="220" textAnchor="end">{number(low * magnitude)}</text>
      {series.buckets.map((b, i) => b.average === null ? null : <g key={b.start}>
        <title>{`${formatSeen(b.start, timezone)}: ${number(b.average)} ${series.unit}; min ${number(b.minimum)}, max ${number(b.maximum)}, n=${b.sample_count}; ${bucketLabels[b.status]}`}</title>
        <line x1={x(i)} x2={x(i)} y1={y(b.minimum!)} y2={y(b.maximum!)} stroke="currentColor" strokeWidth="3" />
        <circle cx={x(i)} cy={y(b.average)} r="3" fill={b.status === "partial" ? "var(--warning)" : "currentColor"} />
      </g>)}
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2" />)}
      <text x="65" y="250">Початок</text><text x="775" y="250" textAnchor="end">Кінець</text>
    </svg>}
    <p className="help-copy">{series.sample_count === 0
      ? series.message_count > 0
        ? "Повідомлення надходили, але для цієї метрики значення були відсутні або некоректні. Це не нульові вимірювання; якість видно в таблиці нижче."
        : "У вибраному періоді немає повідомлень із вимірюваннями. Оберіть інший період або оновіть історію після надходження даних."
      : "Лінія — середнє; вертикальні відрізки — мінімум–максимум. Помаранчеві точки — часткові дані. Пропуски не з’єднуються."}</p>
    <p>{formatSeen(series.start, timezone)} — {formatSeen(series.end, timezone)} · {timezone}</p>
    <p>Валідних вимірювань: {series.sample_count}; повідомлень: {series.message_count}. Інтервал: {series.bucket_seconds} с.</p>
    <details><summary>Таблиця вимірювань</summary><div className="history-table" tabIndex={0} role="region" aria-label="Інтервали історії"><table>
      <caption>Час приймання сервером · {timezone} · {series.unit}</caption>
      <thead><tr><th>Початок</th><th>Кінець</th><th>Якість</th><th>Мін.</th><th>Макс.</th><th>Середнє</th><th>Кількість</th><th>Відсутні</th><th>Некоректні</th></tr></thead>
      <tbody>{series.buckets.map((b) => <tr key={b.start}><td>{formatSeen(b.start, timezone)}</td><td>{formatSeen(b.end, timezone)}</td><td>{bucketLabels[b.status]}</td><td>{number(b.minimum)}</td><td>{number(b.maximum)}</td><td>{number(b.average)}</td><td>{b.sample_count}</td><td>{b.missing_count}</td><td>{b.invalid_count}</td></tr>)}</tbody>
    </table></div></details>
  </>;
}
