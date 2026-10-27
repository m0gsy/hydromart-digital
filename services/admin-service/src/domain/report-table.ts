/**
 * The one shape every scheduled report is rendered from.
 *
 * A report used to be three columns — label, orders, revenue — which is why the dataset list
 * could only ever be revenue groupings. Services now answer with their own columns and the
 * renderers lay out whatever they are given.
 */
export type ReportColumnType = 'text' | 'int' | 'money' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | null;

export interface ReportTable {
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** Printed under the PDF table when present. Aligned to `columns`; null cells stay blank. */
  totals?: ReportCell[] | null;
}

/** The legacy three-column revenue shape, as a table. */
export interface RevenueRow {
  label: string;
  orders: number;
  revenue: number;
}

export const REVENUE_COLUMNS: ReportColumn[] = [
  { key: 'label', label: 'Label', type: 'text' },
  { key: 'orders', label: 'Pesanan', type: 'int' },
  { key: 'revenue', label: 'Pendapatan', type: 'money' },
];

export function revenueTable(rows: RevenueRow[]): ReportTable {
  return {
    columns: REVENUE_COLUMNS,
    rows: rows.map((r) => [r.label, r.orders, r.revenue]),
    totals: rows.length
      ? ['Total', rows.reduce((s, r) => s + r.orders, 0), rows.reduce((s, r) => s + r.revenue, 0)]
      : null,
  };
}

/** Pairs each row's revenue with the previous period's, by label; null delta when there was no base. */
export function comparisonTable(current: RevenueRow[], previous: RevenueRow[]): ReportTable {
  const prev = new Map(previous.map((r) => [r.label, r]));
  const seen = new Set<string>();
  const line = (label: string, cur?: RevenueRow, old?: RevenueRow): ReportCell[] => {
    const rev = cur?.revenue ?? 0;
    const oldRev = old?.revenue ?? 0;
    return [
      label,
      cur?.orders ?? 0,
      rev,
      old?.orders ?? 0,
      oldRev,
      oldRev > 0 ? Math.round(((rev - oldRev) / oldRev) * 1000) / 10 : null,
    ];
  };
  const rows: ReportCell[][] = [];
  for (const r of current) {
    seen.add(r.label);
    rows.push(line(r.label, r, prev.get(r.label)));
  }
  for (const r of previous) if (!seen.has(r.label)) rows.push(line(r.label, undefined, r));
  const sum = (i: number): number => rows.reduce((s, r) => s + (r[i] as number), 0);
  const revenue = sum(2);
  const oldRevenue = sum(4);
  return {
    columns: [
      ...REVENUE_COLUMNS,
      { key: 'prevOrders', label: 'Pesanan periode lalu', type: 'int' },
      { key: 'prevRevenue', label: 'Pendapatan periode lalu', type: 'money' },
      { key: 'delta', label: 'Selisih pendapatan (%)', type: 'percent' },
    ],
    rows,
    totals: rows.length
      ? [
          'Total',
          sum(1),
          revenue,
          sum(3),
          oldRevenue,
          oldRevenue > 0 ? Math.round(((revenue - oldRevenue) / oldRevenue) * 1000) / 10 : null,
        ]
      : null,
  };
}
