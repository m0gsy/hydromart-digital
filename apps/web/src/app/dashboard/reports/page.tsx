'use client';

import { useState } from 'react';
import { ChartBar, Drop, Export, Lock, Truck, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { downloadCsv, toCsv, type CsvCell } from '@/lib/csv';
import { downloadXlsx } from '@/lib/xlsx';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { can, canViewDashboard, isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { DepotDailyReport, DepotWeeklyReport } from '@/lib/types';
import { todayWib } from '@/lib/wib';

const DAY_LABEL = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
const today = () => todayWib();

/** One order of the exported day, as order-service returns it. */
interface DailyExportRow {
  orderNumber: string;
  createdAt: string;
  status: string;
  cancelled: boolean;
  recipientName: string;
  driverName: string | null;
  gallons: number;
  subtotalIdr: number;
  deliveryFeeIdr: number;
  discountIdr: number;
  totalIdr: number;
  isWalkIn: boolean;
}

// A function of `t`, not a constant: these are the CSV column headers an operator opens
// in Excel, and a module constant cannot call a hook.
const dailyHeaders = (t: (k: string) => string) => [
  t('hrFix.depotReports.orderNo'),
  t('hrFix.depotReports.time'),
  t('hrFix.depotReports.status'),
  t('hrFix.depotReports.cancelled'),
  t('hrFix.depotReports.recipient'),
  t('hrFix.depotReports.courier'),
  t('hrFix.depotReports.gallons'),
  t('hrFix.depotReports.subtotal'),
  t('hrFix.depotReports.deliveryFee'),
  t('hrFix.depotReports.discount'),
  t('hrFix.depotReports.total'),
  t('hrFix.depotReports.counterSale'),
];

const dailyRow = (r: DailyExportRow): CsvCell[] => [
  r.orderNumber,
  r.createdAt,
  r.status,
  r.cancelled ? 'YA' : '',
  r.recipientName,
  r.driverName ?? '',
  r.gallons,
  r.subtotalIdr,
  r.deliveryFeeIdr,
  r.discountIdr,
  r.totalIdr,
  r.isWalkIn ? 'YA' : '',
];

/**
 * Download the day's orders. The button used to be `onClick={() => undefined}`.
 *
 * Formatting happens here rather than server-side because the console already owns the
 * file rules (separator, BOM for Excel); a rendered file from the API would be a second
 * copy of those rules to keep in step.
 *
 * Both formats are offered because CSV is what other systems ingest, while .xlsx is what
 * a human opens: the money columns land as real numbers there, and Excel on an Indonesian
 * locale can't split a comma-separated file into one useless column.
 */
function ExportDaily({ depotId, date }: { depotId: string; date: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState<'csv' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: 'csv' | 'xlsx') {
    setBusy(format);
    setError(null);
    try {
      const rows = (
        await api.get<DailyExportRow[]>(endpoints.reports.depotDailyExport(depotId, date), true)
      ).map(dailyRow);
      if (format === 'xlsx') {
        await downloadXlsx(
          `${t('opsFix.reports.fileName')}-${date}.xlsx`,
          dailyHeaders(t),
          rows,
          t('opsFix.reports.sheetName'),
        );
      } else {
        downloadCsv(`${t('opsFix.reports.fileName')}-${date}.csv`, toCsv(dailyHeaders(t), rows));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.reports.exportError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" onClick={() => void run('xlsx')} loading={busy === 'xlsx'}>
          <Export size={16} weight="bold" /> {t('opsFix.reports.exportExcel')}
        </Button>
        <Button variant="ghost" onClick={() => void run('csv')} loading={busy === 'csv'}>
          <Export size={16} weight="bold" /> {t('opsFix.reports.exportCsv')}
        </Button>
      </div>
      {error && (
        <p className="text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What depot-service reports about one depot's day. */
interface DailyCloseView {
  close: {
    businessDate: string;
    closedAt: string;
    cashInIdr: number;
    cashOutIdr: number;
    konterIdr: number;
    codDepositedIdr: number;
    codExpectedIdr: number;
    reopenedAt: string | null;
  } | null;
  lateEntries: number;
  lateAmountIdr: number;
}

/**
 * "Tutup buku" — the depot saying this day is counted.
 *
 * It adds up the two halves of the money that never met: counter cash from the depot
 * cashbook, and the COD the cashier accepted from couriers (delivery-service). The server
 * refuses while a cashier shift is still open, and that refusal is shown here rather than
 * swallowed — it is the most common reason a close is not allowed yet.
 */
function CloseBooks({ depotId, date }: { depotId: string; date: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync<DailyCloseView>(
    () => api.get(endpoints.depots.dailyClose(depotId, date), true),
    [depotId, date],
  );

  const closed = state.data?.close && !state.data.close.reopenedAt;

  async function run(reopen: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        reopen ? endpoints.depots.reopenDay(depotId) : endpoints.depots.closeDay(depotId),
        { businessDate: date },
        true,
      );
      state.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.reports.closeError'));
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return null;
  /*
   * D-7: a 403, or a depot-service outage, used to fall straight through to the button —
   * an inviting "Tutup buku" for a day that may already be closed. Saying nothing is known
   * beats offering an action whose precondition was never read.
   */
  if (state.error) {
    return (
      <p className="text-xs font-medium text-muted" role="status">
        {t('opsFix.reports.closeStateUnreadable')}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {closed ? (
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
            <Lock size={12} weight="bold" className="inline" /> {t('opsFix.reports.booksClosed')}
          </span>
          {/* Reopening is head office only — a depot that can reopen its own books can
              rewrite a total it already signed off. */}
          {can('dailyCloseReopen', customer?.role) && (
            <Button variant="ghost" onClick={() => void run(true)} loading={busy}>
              {t('opsFix.reports.reopen')}
            </Button>
          )}
        </div>
      ) : (
        <Button variant="ghost" onClick={() => void run(false)} loading={busy}>
          <Lock size={16} weight="bold" /> {t('opsFix.reports.closeBooks')}
        </Button>
      )}
      {/* Money that arrived after the book was shut. Never hidden: the cash exists whether
          or not the day was closed. */}
      {closed && (state.data?.lateEntries ?? 0) > 0 && (
        <p className="text-[11px] font-semibold text-amber-700">
          {t('opsFix.reports.lateEntries', {
            n: state.data!.lateEntries,
            amount: formatIDR(state.data!.lateAmountIdr),
          })}
        </p>
      )}
      {error && (
        <p className="max-w-[280px] text-right text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-xl font-extrabold tabular-nums">{value}</span>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </Card>
  );
}

/* ---------- Harian ---------- */
/**
 * The card used to carry a literal `hint="Selisih —"` under a real COD figure — a variance
 * label that was never a variance of anything. The two cash buckets are separate on purpose
 * (a courier's COD is booked to the order, a counter sale to the depot), so the useful
 * second number is the OTHER bucket, not a subtraction of one from the other.
 */
function codHint(
  d: DepotDailyReport,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  return d.cashInDrawerIdr === null
    ? t('opsFix.reports.counterCashNone')
    : t('opsFix.reports.counterCash', { amount: formatIDR(d.cashInDrawerIdr) });
}

function Harian({ depotId }: { depotId: string }) {
  const { t } = useT();
  const [date, setDate] = useState(today());
  const rep = useAsync<DepotDailyReport>(
    () => api.get(endpoints.reports.depotDaily(depotId, date), true),
    [depotId, date],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-extrabold">{t('opsFix.reports.dailyTitle', { date })}</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
          />
          <ExportDaily depotId={depotId} date={date} />
          <CloseBooks depotId={depotId} date={date} />
        </div>
      </div>

      {rep.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : rep.error || !rep.data ? (
        <ErrorState message={rep.error ?? t('opsFix.reports.loadError')} onRetry={rep.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={t('opsFix.reports.ordersDone')}
              value={String(rep.data.orders)}
              hint={t('opsFix.reports.ordersDoneHint')}
            />
            <StatCard label={t('opsFix.reports.revenue')} value={formatIDR(rep.data.revenueIdr)} />
            <StatCard
              label={t('opsFix.reports.codDeposited')}
              value={rep.data.codCollectedIdr === null ? '—' : formatIDR(rep.data.codCollectedIdr)}
              hint={codHint(rep.data, t)}
            />
            <StatCard
              label={t('opsFix.reports.failedDeliveries')}
              value={String(rep.data.failedDeliveries)}
            />
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-app px-4 py-3 text-sm font-extrabold">
              {t('opsFix.reports.perCourier')}
            </div>
            {rep.data.perCourier.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                {t('opsFix.reports.noCourierToday')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-semibold">{t('opsFix.reports.courier')}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t('opsFix.reports.done')}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t('opsFix.reports.failed')}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t('opsFix.reports.cod')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.data.perCourier.map((c) => (
                    <tr key={c.name} className="border-t border-app">
                      <td className="px-4 py-2.5 font-semibold">{c.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.completed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.failed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.codIdr === null ? '—' : formatIDR(c.codIdr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold">
                <Drop size={18} weight="fill" className="text-brand-500" /> {t('opsFix.reports.gallons')}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  [t('opsFix.reports.gallonsIn'), rep.data.gallonsReturned],
                  [t('opsFix.reports.gallonsOut'), rep.data.gallonsDelivered],
                  [t('opsFix.reports.gallonsDamaged'), rep.data.gallonsDamaged],
                ] as [string, number | null][]).map(([label, n]) => (
                  <div key={label} className="rounded-xl bg-[color:var(--surface-soft)] py-3">
                    <div className="text-lg font-extrabold tabular-nums">{n === null ? '—' : n}</div>
                    <div className="text-[11px] text-muted">{label}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="flex items-start gap-3 border-[color:var(--warning)] p-4">
              <Warning size={20} weight="fill" className="mt-0.5 text-[color:var(--warning)]" />
              <div>
                <p className="text-sm font-extrabold">{t('opsFix.reports.lowStockTitle')}</p>
                <p className="text-[12.5px] text-muted">
                  {t('opsFix.reports.lowStockBody')}
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Mingguan ---------- */
function Mingguan({ depotId }: { depotId: string }) {
  const { t } = useT();
  const rep = useAsync<DepotWeeklyReport>(
    () => api.get(endpoints.reports.depotWeekly(depotId), true),
    [depotId],
  );

  if (rep.loading) return <Skeleton className="h-72 w-full" />;
  if (rep.error || !rep.data)
    return <ErrorState message={rep.error ?? t('opsFix.reports.loadError')} onRetry={rep.reload} />;

  const peak = Math.max(1, ...rep.data.revenueByDay.map((d) => d.revenueIdr));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-extrabold">{t('opsFix.reports.weeklyTitle')}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('opsFix.reports.orders')} value={String(rep.data.orders)} />
        <StatCard label={t('opsFix.reports.revenue')} value={formatIDR(rep.data.revenueIdr)} />
        <StatCard label={t('opsFix.reports.avgPerDay')} value={formatIDR(rep.data.avgPerDayIdr)} />
        <StatCard
          label={t('opsFix.reports.slaOnTime')}
          value={rep.data.slaOnTimePct != null ? `${rep.data.slaOnTimePct}%` : '—'}
        />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-extrabold">
          <ChartBar size={18} weight="fill" className="text-brand-500" /> {t('opsFix.reports.revenuePerDay')}
        </div>
        {rep.data.revenueByDay.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('opsFix.reports.noRevenueThisWeek')}</p>
        ) : (
          <div className="flex items-end gap-2" style={{ height: 160 }}>
            {rep.data.revenueByDay.map((d) => (
              <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-md ${d.revenueIdr === peak ? 'bg-brand-600' : 'bg-brand-50'}`}
                  style={{ height: `${Math.round((d.revenueIdr / peak) * 120) + 4}px` }}
                  title={formatIDR(d.revenueIdr)}
                />
                <span className="truncate text-[10px] text-muted">{DAY_LABEL.format(new Date(d.day))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-app px-4 py-3 text-sm font-extrabold">
          {t('opsFix.reports.topProducts')}
        </div>
        {rep.data.topProducts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">{t('opsFix.reports.noSales')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {rep.data.topProducts.map((p, i) => (
              <li key={p.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-semibold">
                  <span className="mr-2 text-muted tabular-nums">{i + 1}.</span>
                  {p.label}
                </span>
                <span className="tabular-nums text-muted">
                  {p.qty} {t('opsFix.reports.unit')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {rep.data.topCourier && (
        <Card className="flex items-center gap-3 bg-brand-800 p-4 text-white" elevated={false}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
            <Truck size={22} weight="fill" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
              {t('opsFix.reports.topCourier')}
            </p>
            <p className="text-base font-extrabold">{rep.data.topCourier.name}</p>
            <p className="text-[12.5px] text-white/80 tabular-nums">
              {t('opsFix.reports.deliveries', { n: rep.data.topCourier.delivered })}
              {rep.data.topCourier.rating != null && ` · ${rep.data.topCourier.rating.toFixed(1)}★`}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

const TAB_KEY = { harian: 'tabDaily', mingguan: 'tabWeekly' } as const;

function Body() {
  const { t } = useT();
  const { scopedId, selected } = useDepot();
  const [tab, setTab] = useState<'harian' | 'mingguan'>('harian');

  if (!scopedId) {
    return (
      <CenterState title={t('opsFix.reports.pickDepot')} icon={<ChartBar size={40} weight="fill" />}>
        {t('opsFix.reports.pickDepotBody')}
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-xl bg-[color:var(--surface-soft)] p-1">
        {(['harian', 'mingguan'] as const).map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${
              tab === name ? 'bg-brand-600 text-white' : 'text-muted'
            }`}
          >
            {t(`opsFix.reports.${TAB_KEY[name]}`)}
          </button>
        ))}
      </div>
      {selected && (
        <p className="-mt-2 text-xs text-muted">
          {t('opsFix.reports.depotLabel', { name: selected.name })}
        </p>
      )}
      {tab === 'harian' ? <Harian depotId={scopedId} /> : <Mingguan depotId={scopedId} />}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  // Operators own the depot report screens (design 2d/7d), so isStaff opens the gate
  // alongside the dashboard capability held by managers/HQ.
  if (!isStaff(customer?.role) && !canViewDashboard(customer?.role)) {
    return (
      <CenterState title={t('hrFix.depotReports.staffOnly')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.reports.gateBody2')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
