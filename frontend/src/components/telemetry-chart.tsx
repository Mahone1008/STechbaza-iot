"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { bucketLabels, type Series } from "@/lib/api/telemetry-series";
import { formatSeen } from "@/lib/api/inventory";
import { channelLabel } from "@/lib/api/overview";

const numberFormatter = new Intl.NumberFormat("uk-UA", { maximumSignificantDigits: 8 });
const number = (value: number | null) => (value === null ? "Немає даних" : numberFormatter.format(value));
const axisNumber = (value: number) =>
  new Intl.NumberFormat("uk-UA", {
    maximumSignificantDigits: 4,
    notation: Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.001) ? "scientific" : "standard",
  }).format(value);

export function TelemetryChart({ series, timezone }: { series: Series; timezone: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = series.buckets.flatMap((b) => (b.minimum === null ? [] : [b.minimum, b.maximum!]));
  // Normalize before subtraction: finite large positive and negative values must not overflow.
  const magnitude = Math.max(1, ...values.map(Math.abs));
  const low = values.length ? Math.min(...values.map((n) => n / magnitude)) : 0;
  const high = values.length ? Math.max(...values.map((n) => n / magnitude)) : 1;
  const rangeLow = high === low ? Math.max(-1, low - 0.1) : low;
  const rangeHigh = high === low ? Math.min(1, high + 0.1) : high;
  const left = 70,
    right = width - 16,
    top = 20,
    bottom = 224;
  const y = (n: number) => bottom - ((n / magnitude - rangeLow) / (rangeHigh - rangeLow)) * (bottom - top);
  const x = (index: number) => left + ((index + 0.5) / series.buckets.length) * (right - left);
  const segments: string[] = [];
  let segment = "";
  let lastSample = 0;
  for (let i = 0; i < series.buckets.length; i += 1) {
    const bucket = series.buckets[i]!;
    if (bucket.average === null) {
      if (segment) segments.push(segment);
      segment = "";
    } else {
      lastSample = i;
      segment += `${segment ? " L" : "M"}${x(i)},${y(bucket.average)}`;
    }
  }
  if (segment) segments.push(segment);
  const selectedIndex = series.buckets.findIndex((bucket) => bucket.start === selectedTime);
  const index = selectedIndex < 0 ? lastSample : selectedIndex;
  const selected = series.buckets[index]!;
  const quantity = (value: number | null) => (value === null ? number(value) : `${number(value)} ${series.unit}`);
  const from = Date.parse(series.start),
    to = Date.parse(series.end);
  const dateFormatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const crossesDate = dateFormatter.format(from) !== dateFormatter.format(to);
  const timeLabel = (time: number) =>
    new Intl.DateTimeFormat("uk-UA", {
      timeZone: timezone,
      ...(crossesDate ? { day: "2-digit", month: "2-digit" } : {}),
      hour: "2-digit",
      minute: "2-digit",
    }).format(time);
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - bounds.left) / bounds.width) * width;
    const next = Math.max(
      0,
      Math.min(series.buckets.length - 1, Math.floor(((position - left) / (right - left)) * series.buckets.length)),
    );
    setSelectedTime(series.buckets[next]!.start);
  };
  const axisSteps = width < 520 ? 2 : 4;
  return (
    <div className="telemetry-chart-content" ref={container}>
      {series.sample_count === 0 ? (
        <p role="status">За цей період немає вимірювань для графіка.</p>
      ) : (
        <>
          <svg
            className="telemetry-chart"
            viewBox={`0 0 ${width} 280`}
            role="img"
            aria-label={`Історія ${channelLabel(series.metric)}, ${series.unit}. Середнє значення та межі вимірювань. Пропуски означають відсутність даних.`}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse") inspect(event);
            }}
            onPointerDown={inspect}
          >
            {Array.from({ length: 5 }, (_, i) => {
              const value = rangeLow + ((rangeHigh - rangeLow) * i) / 4;
              const position = bottom - ((bottom - top) * i) / 4;
              return (
                <g key={i}>
                  <line x1={left} y1={position} x2={right} y2={position} className="chart-grid-line" />
                  <text x={left - 10} y={position + 4} textAnchor="end">
                    {axisNumber(value * magnitude)}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: axisSteps + 1 }, (_, i) => {
              const position = left + ((right - left) * i) / axisSteps;
              return (
                <g key={i}>
                  <line x1={position} y1={top} x2={position} y2={bottom} className="chart-grid-line" />
                  <text x={position} y={250} textAnchor={i === 0 ? "start" : i === axisSteps ? "end" : "middle"}>
                    {timeLabel(from + ((to - from) * i) / axisSteps)}
                  </text>
                </g>
              );
            })}
            {series.buckets.map((bucket, i) =>
              bucket.average === null ? null : (
                <g key={bucket.start}>
                  <title>{`${formatSeen(bucket.start, timezone)}: ${number(bucket.average)} ${series.unit}; мінімум ${number(bucket.minimum)}, максимум ${number(bucket.maximum)}, вимірювань: ${bucket.sample_count}; ${bucketLabels[bucket.status]}`}</title>
                  <line x1={x(i)} x2={x(i)} y1={y(bucket.minimum!)} y2={y(bucket.maximum!)} className="chart-range" />
                  <circle
                    cx={x(i)}
                    cy={y(bucket.average)}
                    r="3"
                    fill={bucket.status === "partial" ? "var(--warning)" : "currentColor"}
                  />
                </g>
              ),
            )}
            {segments.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2" />
            ))}
            <line x1={x(index)} x2={x(index)} y1={top} y2={bottom} className="chart-cursor" />
            {selected.average !== null && (
              <circle cx={x(index)} cy={y(selected.average)} r="5" className="chart-selected" />
            )}
          </svg>
          <div className="chart-inspector">
            <label className="chart-time-control">
              Час на графіку
              <input
                type="range"
                min={0}
                max={series.buckets.length - 1}
                step={1}
                value={index}
                aria-valuetext={`${formatSeen(selected.start, timezone)}: ${quantity(selected.average)}; ${bucketLabels[selected.status]}`}
                onChange={(event) => setSelectedTime(series.buckets[Number(event.target.value)]!.start)}
              />
            </label>
            <p className="chart-selection-time">
              {formatSeen(selected.start, timezone)} / {formatSeen(selected.end, timezone)} ·{" "}
              {bucketLabels[selected.status]}
            </p>
            <dl className="chart-selection-values">
              <div>
                <dt>Середнє</dt>
                <dd>{quantity(selected.average)}</dd>
              </div>
              <div>
                <dt>Мінімум</dt>
                <dd>{quantity(selected.minimum)}</dd>
              </div>
              <div>
                <dt>Максимум</dt>
                <dd>{quantity(selected.maximum)}</dd>
              </div>
            </dl>
          </div>
        </>
      )}
      <p className="help-copy">
        {series.sample_count === 0
          ? series.message_count > 0
            ? "Надходили неповні або некоректні дані. Подробиці в таблиці вимірювань."
            : "Повідомлень із вимірюваннями немає. Оберіть інший період або оновіть історію після надходження даних."
          : "Лінія: середнє. Вертикальні відрізки: мінімум і максимум. Помаранчеві точки: неповні дані. Пропуски не з’єднуються. Торкніться графіка або оберіть час повзунком."}
      </p>
      <p className="chart-period">
        {formatSeen(series.start, timezone)} / {formatSeen(series.end, timezone)} · {timezone}
      </p>
      <p className="help-copy">
        Вимірювань для графіка: {series.sample_count}; повідомлень: {series.message_count}. Інтервал:{" "}
        {series.bucket_seconds} с.
      </p>
      <details className="chart-table-details">
        <summary>Таблиця вимірювань</summary>
        <div className="history-table" tabIndex={0} role="region" aria-label="Інтервали історії">
          <table>
            <caption>
              Час надходження даних · {timezone} · {series.unit}
            </caption>
            <thead>
              <tr>
                <th>Початок</th>
                <th>Кінець</th>
                <th>Якість</th>
                <th>Мін.</th>
                <th>Макс.</th>
                <th>Середнє</th>
                <th>Кількість</th>
                <th>Відсутні</th>
                <th>Некоректні</th>
              </tr>
            </thead>
            <tbody>
              {series.buckets.map((bucket) => (
                <tr key={bucket.start}>
                  <td>{formatSeen(bucket.start, timezone)}</td>
                  <td>{formatSeen(bucket.end, timezone)}</td>
                  <td>{bucketLabels[bucket.status]}</td>
                  <td>{number(bucket.minimum)}</td>
                  <td>{number(bucket.maximum)}</td>
                  <td>{number(bucket.average)}</td>
                  <td>{bucket.sample_count}</td>
                  <td>{bucket.missing_count}</td>
                  <td>{bucket.invalid_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
