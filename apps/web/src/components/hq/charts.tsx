'use client';

// Hand-rolled CSS/SVG charts — no chart library (matches the div-bar convention in
// dashboard/page.tsx). Presentational + typed. All values are pre-computed by callers.

/** Vertical bars for a monthly revenue trend. */
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
export function CohortGrid({
  rows,
}: {
  rows: { label: string; cells: number[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="whitespace-nowrap pr-2 text-xs font-medium text-muted">{r.label}</td>
              {r.cells.map((c, i) => (
                <td key={i}>
                  <span
                    title={`${Math.round(c * 100)}%`}
                    className="block h-6 w-8 rounded"
                    style={{
                      background: `color-mix(in srgb, var(--brand-600, #0c97ac) ${Math.round(
                        Math.max(0, Math.min(1, c)) * 100,
                      )}%, var(--surface-muted))`,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
