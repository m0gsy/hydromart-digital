'use client';

// Hand-rolled CSS/SVG charts — no chart library (matches the div-bar convention in
// dashboard/page.tsx). Presentational + typed. All values are pre-computed by callers.

/** Vertical bars for a monthly revenue trend. */
/**
 * The number was in `title=` and nowhere else — a hover tooltip. A phone has no hover, so on
 * the surface this chart is mostly read on, the value was unreachable; a screen reader never
 * had it at all. It is rendered now, and `title` is kept for the pointer that does hover.
 *
 * `Math.max(2, …)` keeps a zero month visible as a sliver rather than as nothing, which is
 * right — but a 2px sliver on a dark card reads as an empty chart, so the value above it is
 * what actually tells the reader the month was zero.
 */
export function BarTrend({
  data,
  className,
}: {
  data: { label: string; value: number }[];
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={`flex items-end gap-1.5 ${className ?? ''}`} style={{ height: 120 }}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="w-full truncate text-center text-[9px] tabular-nums text-muted">
            {compactIdr(d.value)}
          </span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-brand-600"
              style={{ height: `${Math.max(2, Math.round((d.value / max) * 100))}%` }}
              title={String(d.value)}
            />
          </div>
          <span className="w-full truncate text-center text-[9px] text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 263000 → "263rb", 1_400_000 → "1,4jt". A bar label has one line and no room for a total. */
function compactIdr(value: number): string {
  const n = Math.round(value);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace('.', ',')}m`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}rb`;
  return String(n);
}

/** Inline SVG line for a compact trend (1c). */
export function Sparkline({
  data,
  width = 240,
  height = 56,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2) {
    return <div className="text-xs text-muted">—</div>;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const y = (v: number) => height - ((v - min) / span) * (height - 4) - 2;
  const pts = data.map((v, i) => `${i * stepX},${y(v)}`).join(' ');
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
      aria-hidden="true"
    >
      <polygon points={area} fill="var(--brand-100, rgba(12,151,172,0.12))" opacity={0.5} />
      <polyline
        points={pts}
        fill="none"
        stroke="var(--brand-600, #0c97ac)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Score bands: green ≥0.95, teal ≥0.9, amber ≥0.8, red below.
function band(score: number): string {
  if (score >= 0.95) return 'bg-green-500';
  if (score >= 0.9) return 'bg-brand-600';
  if (score >= 0.8) return 'bg-amber-500';
  return 'bg-red-500';
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Horizontal ranking bar with medal position, coloured by score band (design 22c). */
export function RankBar({
  position,
  label,
  score,
  caption,
}: {
  position: number;
  label: string;
  score: number; // 0..1
  caption?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums">
        {MEDALS[position] ?? position + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold">{label}</span>
          <span className="shrink-0 text-xs font-bold tabular-nums text-muted">{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
          <div className={`h-full rounded-full ${band(score)}`} style={{ width: `${pct}%` }} />
        </div>
        {caption && <span className="mt-0.5 block text-[11px] text-muted">{caption}</span>}
      </div>
    </div>
  );
}

/** Horizontal stock-level bar: green / amber / red by fill ratio (design 16a). */
export function StockBar({
  label,
  value,
  max,
  low,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  low?: boolean;
  unit?: string;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const pct = Math.round(ratio * 100);
  const color = low ? 'bg-red-500' : ratio < 0.5 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-xs font-bold tabular-nums">
        {value}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

/** Retention cohort grid — rows = cohorts, cells shaded by retention ratio (0..1). */
export function CohortGrid({ rows }: { rows: { label: string; cells: number[] }[] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="whitespace-nowrap pr-2 text-xs font-medium text-muted">{r.label}</td>
              {r.cells.map((c, i) => (
                <td key={i}>
                  <span
                    title={`${Math.round(c * 100)}%`}
                    className="flex h-6 w-9 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
                    style={{
                      background: `color-mix(in srgb, var(--brand-600, #0c97ac) ${Math.round(
                        Math.max(0, Math.min(1, c)) * 100,
                      )}%, var(--surface-muted))`,
                      // Dark ink on a pale cell, light on a saturated one: the number has to
                      // stay legible across the whole ramp, not only at one end of it.
                      color: c >= 0.55 ? 'var(--surface)' : 'var(--text)',
                    }}
                  >
                    {Math.round(c * 100)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line of a {@link MultiLine} chart. */
export interface LineSeries {
  label: string;
  values: number[];
  /** Which vertical scale the line is read against: orders and rupiah need their own. */
  axis: 'left' | 'right';
  tone: 'brand' | 'amber';
  /** Rupiah values are printed compact ("1,4jt"); counts are printed as they are. */
  money?: boolean;
}

const LINE_COLOR: Record<LineSeries['tone'], string> = {
  brand: 'var(--brand-600, #0c97ac)',
  amber: 'var(--amber-500, #d97706)',
};

function printValue(value: number, money?: boolean): string {
  return money ? compactIdr(value) : String(Math.round(value));
}

/**
 * Two series on two vertical scales over the same labels (revenue and order count, say).
 *
 * The scale of each axis is that axis's own maximum, so a line of 40 orders and a line of
 * 4,000,000 rupiah both use the full height; the legend states each maximum so the reader
 * can still tell what a line's height means. Every value is also in the DOM as an
 * `sr-only` table: a phone has no hover, and a screen reader has no picture.
 */
export function MultiLine({
  labels,
  series,
  height = 180,
  ariaLabel,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  ariaLabel: string;
}) {
  if (labels.length === 0 || series.length === 0) {
    return <div className="text-xs text-muted">—</div>;
  }
  const width = 600;
  const pad = 8;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const maxFor = (axis: LineSeries['axis']) =>
    Math.max(1, ...series.filter((s) => s.axis === axis).flatMap((s) => s.values));
  const maxes = { left: maxFor('left'), right: maxFor('right') };
  const x = (i: number) =>
    labels.length === 1 ? width / 2 : pad + (i / (labels.length - 1)) * innerW;
  const y = (v: number, axis: LineSeries['axis']) =>
    pad + innerH - (Math.max(0, v) / maxes[axis]) * innerH;
  return (
    <figure className="m-0">
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: LINE_COLOR[s.tone] }}
            />
            <span className="font-medium text-[color:var(--text)]">{s.label}</span>
            <span className="tabular-nums">max {printValue(maxes[s.axis], s.money)}</span>
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height }}
        role="img"
        aria-label={ariaLabel}
      >
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={width - pad}
            y1={pad + innerH * f}
            y2={pad + innerH * f}
            stroke="var(--border, #e9e7df)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => (
          <g key={s.label}>
            {labels.length > 1 && (
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v, s.axis)}`).join(' ')}
                fill="none"
                stroke={LINE_COLOR[s.tone]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {labels.length <= 31 &&
              s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v, s.axis)} r={2.5} fill={LINE_COLOR[s.tone]} />
              ))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{labels[0]}</span>
        {labels.length > 2 && <span>{labels[Math.floor((labels.length - 1) / 2)]}</span>}
        {labels.length > 1 && <span>{labels[labels.length - 1]}</span>}
      </div>
      {/* The wrapper clips it: `sr-only` on a table itself does not, and its width pushed a phone-wide page sideways. */}
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col" />
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={`${l}-${i}`}>
                <th scope="row">{l}</th>
                {series.map((s) => (
                  <td key={s.label}>{printValue(s.values[i] ?? 0, s.money)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/**
 * A half-circle progress gauge (revenue against a target).
 *
 * The number printed in the middle is the TRUE percentage, which may pass 100; only the arc is
 * clipped at full. A gauge that stops at 100% would say "target met" for a depot that doubled
 * it, and one that clips the number says the same thing quieter. A non-positive `max` has no
 * percentage to show, so nothing is drawn rather than a misleading empty arc.
 */
export function GaugeChart({
  value,
  max,
  caption,
  ariaLabel,
}: {
  value: number;
  max: number;
  caption?: string;
  ariaLabel: string;
}) {
  if (!(max > 0) || !Number.isFinite(value) || !Number.isFinite(max)) {
    return <div className="text-xs text-muted">—</div>;
  }
  const pct = Math.round((Math.max(0, value) / max) * 100);
  const shown = Math.min(1, Math.max(0, value) / max);
  const cx = 100;
  const cy = 100;
  const r = 80;
  // Angle runs 0 (left) to PI (right) along the top half.
  const theta = shown * Math.PI;
  const end = { x: cx - r * Math.cos(theta), y: cy - r * Math.sin(theta) };
  return (
    <div className="relative mx-auto w-full max-w-[260px]" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 200 110" className="w-full" aria-hidden="true">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--surface-muted, #faf9f5)"
          strokeWidth={16}
          strokeLinecap="round"
        />
        {shown > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`}
            fill="none"
            stroke="var(--brand-600, #0c97ac)"
            strokeWidth={16}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-2xl font-bold tabular-nums">{pct}%</p>
        {caption && <p className="text-xs text-muted">{caption}</p>}
      </div>
    </div>
  );
}

/**
 * Whole-number percentages of a set of positive values that add up to exactly 100
 * (largest remainder). Rounding each one on its own makes three equal slices read 33+33+33.
 * A value too small to earn a point gets 0, which the caller prints as "<1%".
 */
export function wholeShares(values: readonly number[]): number[] {
  const sum = values.reduce((n, v) => n + v, 0);
  if (!(sum > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / sum) * 100);
  const floors = exact.map((x) => Math.floor(x));
  let left = 100 - floors.reduce((n, x) => n + x, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** One slice of a {@link DonutChart}. */
export interface DonutSegment {
  label: string;
  value: number;
}

/** Slice colours, brand first. A legend with the label and the number is what tells them apart. */
const DONUT_COLORS = [
  'var(--brand-600, #0c97ac)',
  'var(--amber-500, #d97706)',
  'var(--brand-300, #6cc7d3)',
  'var(--amber-300, #fcd34d)',
  'var(--brand-800, #0a6573)',
  'var(--text-muted, #64757c)',
];

/**
 * A ring of shares with its total in the middle and a legend that says every figure in text.
 *
 * The legend, not the colours, is how a slice is identified: it lists the label, the share and
 * the value for every slice, so the chart reads the same in greyscale, on a phone in sun, and
 * to a screen reader. Slices of zero are left out (a 0% slice is a legend line about nothing),
 * and a ring with no value at all draws nothing rather than an empty circle.
 */
export function DonutChart({
  segments,
  total,
  format = (n: number) => String(Math.round(n)),
  ariaLabel,
}: {
  segments: DonutSegment[];
  /** Printed under the number in the middle ("Total"). */
  total: string;
  format?: (value: number) => string;
  ariaLabel: string;
}) {
  const shown = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const sum = shown.reduce((n, s) => n + s.value, 0);
  if (sum <= 0) return <div className="text-xs text-muted">—</div>;
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shares = wholeShares(shown.map((s) => s.value));
  return (
    <figure className="m-0 flex flex-wrap items-center gap-4" aria-label={ariaLabel}>
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
          {shown.map((s, i) => {
            const len = (s.value / sum) * c;
            const el = (
              <circle
                key={`${i}-${s.label}`}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
                strokeWidth={14}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-bold tabular-nums">{format(sum)}</span>
          <span className="text-[10px] text-muted">{total}</span>
        </div>
      </div>
      {/* 11rem floor: below it the legend wraps under the ring instead of squeezing beside it and pushing a 320px page sideways. */}
      <ul className="m-0 flex min-w-[11rem] flex-1 list-none flex-col gap-1.5 p-0 text-xs">
        {shown.map((s, i) => (
          <li key={`${i}-${s.label}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{format(s.value)}</span>
            <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
              {shares[i] === 0 ? '<1%' : `${shares[i]}%`}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** One row of a {@link HeatTable}: a label and one value per column. */
export interface HeatRow {
  label: string;
  values: number[];
}

/**
 * A grid of amounts shaded by size (how long money has waited, by method).
 *
 * The number is IN the cell: shade is a second channel, never the only one, so the table reads
 * the same in greyscale and to a screen reader. A zero prints as a dash rather than a faint
 * "0", and a row total on the right says what the row adds up to.
 */
export function HeatTable({
  columns,
  rows,
  format,
  rowHeader,
  totalLabel,
  ariaLabel,
}: {
  columns: string[];
  rows: HeatRow[];
  format: (value: number) => string;
  rowHeader: string;
  totalLabel: string;
  ariaLabel: string;
}) {
  const max = Math.max(0, ...rows.flatMap((r) => r.values));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-xs" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-left font-medium text-muted">
              {rowHeader}
            </th>
            {columns.map((c) => (
              <th key={c} scope="col" className="p-2 text-right font-medium text-muted">
                {c}
              </th>
            ))}
            <th scope="col" className="p-2 text-right font-semibold">
              {totalLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="p-2 text-left font-semibold">
                {r.label}
              </th>
              {columns.map((c, i) => {
                const v = r.values[i] ?? 0;
                const strength = max > 0 && v > 0 ? Math.max(8, Math.round((v / max) * 50)) : 0;
                return (
                  <td
                    key={c}
                    className="p-2 text-right tabular-nums"
                    style={
                      strength > 0
                        ? {
                            background: `color-mix(in srgb, var(--brand-600, #0c97ac) ${strength}%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {v > 0 ? format(v) : <span className="text-muted">—</span>}
                  </td>
                );
              })}
              <td className="p-2 text-right font-semibold tabular-nums">
                {format(r.values.reduce((n, v) => n + v, 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
