'use client';

import { Card } from '@/components/ui';
import { monthRangeWib, recentMonthsWib } from '@/lib/wib';

/**
 * Flow plan 5b: the one depot-comparison table, for head office (/hq/compare) and the depot
 * console (/dashboard/compare). They were two screens with two periods — head office the last
 * 30 days, the depot the WIB month — and two tables. Both now compare ONE business month, picked
 * and stated, through this table.
 */
export interface CompareColumn {
  id: string;
  name: string;
  sub?: string;
  /** The reader's own depot, tinted. */
  highlight?: boolean;
}

export interface CompareRow {
  key: string;
  label: string;
  higherIsBetter: boolean;
  /** null = no reading for that depot: shown as "—", never counted for "best". */
  value: (columnId: string) => number | null;
  format: (n: number) => string;
}

/** `YYYY-MM` -> that WIB month's [from, to) as ISO instants. */
export const monthRangeOfKey = (key: string): { from: string; to: string } =>
  monthRangeWib(new Date(`${key}-15T00:00:00.000Z`));

export function CompareMonthPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (key: string) => void;
  label: string;
}) {
  // Recomputed each render: an app left open across a month end offers the new month.
  const months = recentMonthsWib(12);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="surface-elevated rounded-lg border border-app px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
    >
      {months.map((m) => (
        <option key={m.key} value={m.key}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

/** The month the picker opens on: the running WIB month. */
export const currentMonthKey = (): string => recentMonthsWib(1)[0]!.key;

export function CompareTable({
  columns,
  rows,
  metricLabel,
  bestLabel,
}: {
  columns: CompareColumn[];
  rows: CompareRow[];
  metricLabel: string;
  bestLabel: string;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-app">
            <th className="p-3 text-left font-semibold text-[color:var(--text-muted)]">{metricLabel}</th>
            {columns.map((c) => (
              <th
                key={c.id}
                className={`p-3 text-right font-bold ${c.highlight ? 'bg-brand-50 text-brand-800' : ''}`}
              >
                <span className="block">{c.name}</span>
                {c.sub && (
                  <span className="text-xs font-medium text-[color:var(--text-muted)]">{c.sub}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const values = columns.map((c) => r.value(c.id));
            const present = values.filter((v): v is number => v !== null);
            // A "best" of one reading is no comparison: it needs at least two.
            const best =
              present.length > 1 ? (r.higherIsBetter ? Math.max(...present) : Math.min(...present)) : null;
            return (
              <tr key={r.key} className="border-b border-app last:border-0">
                <td className="p-3 font-medium">{r.label}</td>
                {columns.map((c, i) => {
                  const v = values[i] ?? null;
                  const isBest = best !== null && v === best;
                  return (
                    <td
                      key={c.id}
                      className={`p-3 text-right tabular-nums ${c.highlight ? 'bg-brand-50' : ''} ${
                        isBest ? 'font-bold text-brand-700' : ''
                      }`}
                    >
                      {v === null ? <span className="text-[color:var(--text-muted)]">—</span> : r.format(v)}
                      {isBest && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase text-brand-600">{bestLabel}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
