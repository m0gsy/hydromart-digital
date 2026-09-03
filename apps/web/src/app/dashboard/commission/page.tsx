'use client';

import { useT } from '@/lib/locale-context';
import { Info, Lock, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canViewDepotFinance } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CommissionCourier, CommissionRun, Customer } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

/** UTC calendar-month window [first-of-month, first-of-next-month), matching the backend. */
function monthWindow(): { from: string; to: string } {
  const n = new Date();
  return {
    from: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function CourierRow({ c, name }: { c: CommissionCourier; name: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-[color:var(--text-muted)] tabular-nums">
          {t('hrFix.commission.deliveredPaid', {
            delivered: c.delivered,
            gross: formatIDR(c.grossIdr),
          })}
          {c.shortfallIdr > 0 && ' ' + t('hrFix.commission.settlementDiff')}
        </p>
        {/* E-1: a delivery this depot recorded that the payer never paid for. Shown rather
            than smoothed over — the report used to multiply its own count by its own rate,
            so it always balanced and this gap could not appear. */}
        {c.paidDeliveries < c.delivered && (
          <p className="text-xs font-semibold text-[color:var(--warning)] tabular-nums">
            {t('hrFix.commission.unpaidDeliveries', {
              n: c.delivered - c.paidDeliveries,
            })}
          </p>
        )}
        {c.shortfallIdr > 0 && (
          <p className="text-xs font-semibold text-[color:var(--warning)] tabular-nums">
            − potong selisih <Money amount={c.shortfallIdr} />
          </p>
        )}
      </div>
      <Money amount={c.netIdr} className="shrink-0 font-bold" />
    </div>
  );
}

function CommissionBody() {
  const { t } = useT();
  const { scopedId, selected } = useDepot();
  const { from, to } = monthWindow();

  const data = useAsync<{ run: CommissionRun; names: Map<string, string> }>(async () => {
    if (!scopedId) return { run: null as unknown as CommissionRun, names: new Map() };
    const [run, drivers] = await Promise.all([
      api.get<CommissionRun>(endpoints.deliveries.commission(scopedId, { from, to }), true),
      // Names live in auth-service; a failure here just falls back to a short id.
      api.get<Customer[]>(endpoints.auth.drivers, true).catch(() => [] as Customer[]),
    ]);
    const names = new Map(drivers.map((d) => [d.id, d.fullName ?? d.phone]));
    return { run, names };
  }, [scopedId, from, to]);

  const run = data.data?.run ?? null;
  const names = data.data?.names ?? new Map<string, string>();
  const nameOf = (courierId: string) => names.get(courierId) ?? t('opsFix.commission.unnamedCourier', { id: courierId.slice(0, 8) });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hrFix.commission.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {selected ? t('opsFix.common.depotPrefix', { name: selected.name }) : ''}
            {t('opsFix.commission.periodReady', { month: MONTH })}
          </p>
        </div>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : run?.source === 'unavailable' ? (
        // No local fallback rate, so no figures: the payer could not be read, and a number
        // computed here instead is exactly the second opinion E-1 removed.
        <ErrorState message={t('hrFix.commission.payoutUnavailable')} onRetry={data.reload} />
      ) : !run || run.couriers.length === 0 ? (
        <CenterState title={t('hrFix.commission.empty')} icon={<Wallet size={40} weight="fill" />}>
          {t('hrFix.commission.emptyBody', { month: MONTH })}
        </CenterState>
      ) : (
        <>
          <Card elevated className="flex items-center justify-between gap-4 bg-brand-700 p-6 text-on-brand">
            <div>
              <p className="text-sm font-medium text-on-brand/80">{t('hrFix.commission.periodTotal')}</p>
              <Money amount={run.totalIdr ?? 0} className="text-2xl font-bold" />
            </div>
            {/*
              OPS-03: there was a "Bayar semua" button here whose entire implementation was
              `onClick={() => setPaid(true)}`. No api.post existed anywhere in this file. A
              manager pressed it at month end, the label changed to "Terbayar", nothing was
              recorded anywhere, no courier was paid — and after a reload it read "Bayar
              semua" again, so the same manager could not tell whether they had paid or not.

              It is not a missing call, it is a screen that never had the power: commission
              is credited to each courier's ledger as their deliveries complete
              (`ledger/internal` in payout-service) and the courier withdraws it themselves.
              This screen reports. Saying so is the honest control.
            */}
            <p className="max-w-[18rem] shrink-0 text-right text-xs text-on-brand/80">
              {t('hrFix.commission.howPaid')}
            </p>
          </Card>

          <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
            {run.couriers.map((c) => (
              <CourierRow key={c.courierId} c={c} name={nameOf(c.courierId)} />
            ))}
          </Card>
        </>
      )}

      <Card className="flex items-start gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          {t('hrFix.commission.depotNote')}{' '}
          <strong className="text-[color:var(--text)]">{t('hrFix.commission.franchiseShare')}</strong>{t('hrFix.commission.depotNoteAfter')}
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDepotFinance(customer?.role)) {
    return (
      <CenterState title={t('hrFix.commission.managerOnly')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.commission.gateBody2')}
      </CenterState>
    );
  }
  return <CommissionBody />;
}

export default function CommissionPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
