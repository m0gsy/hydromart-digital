'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Lightning, LockSimple } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { CourierEarningsSummary, CourierPerformance, Shift } from '@/lib/types';

// ponytail: no monthly earnings-target API — stub Rp 5jt so the progress bar has a
// denominator. Wire the real payout target when payout-service exposes one.
const MONTH_TARGET = 5_000_000;

// ponytail: tiered-incentive schedule is backend-blocked — static ladder keyed to the
// REAL weekly delivered count. Replace with a payout incentive API when it exists.
const TIERS = [
  { n: 25, bonus: 25_000 },
  { n: 40, bonus: 60_000 },
  { n: 50, bonus: 100_000 },
];

/** YYYY-MM-DD of the WIB (UTC+7) Monday of the current week — matches the home/perf pages. */
function thisWibMonday(): string {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const daysFromMon = (wib.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - daysFromMon));
  return monday.toISOString().slice(0, 10);
}

function ShiftGoal() {
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? undefined;

  const earnings = useAsync<CourierEarningsSummary>(() => api.get(endpoints.courierPayout.summary, true), []);
  const perf = useAsync<CourierPerformance>(
    () => api.get(endpoints.deliveries.performance(thisWibMonday(), depotId), true),
    [depotId],
  );
  const shift = useAsync<Shift | null>(() => api.get(endpoints.deliveries.shifts.current, true), []);

  if (earnings.loading || perf.loading) return <div className="p-5"><Skeleton className="h-96 w-full" /></div>;
  if (earnings.error || !earnings.data || perf.error || !perf.data) {
    return (
      <div className="p-5">
        <ErrorState message={earnings.error ?? perf.error ?? t('courierFix.shiftGoal.loadError')} onRetry={() => { earnings.reload(); perf.reload(); }} />
      </div>
    );
  }

  const month = earnings.data.monthEarnings;
  const pct = Math.min(100, Math.round((month / MONTH_TARGET) * 100));
  const delivered = perf.data.delivered;
  const deliveryTarget = perf.data.target || TIERS[1]!.n;

  // Remaining shift from the real check-in window; null once the shift has ended.
  const endMs = shift.data?.expectedEndAt ? new Date(shift.data.expectedEndAt).getTime() : null;
  const remMin = endMs ? Math.floor((endMs - Date.now()) / 60000) : null;
  const remaining =
    remMin != null && remMin > 0 ? `${Math.floor(remMin / 60)}j ${remMin % 60}m` : t('courierFix.shiftGoal.shiftEnded');

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-sm font-extrabold">{t('courierFix.shiftGoal.title')}</div>
          <div className="text-[11px] text-[color:var(--muted)]">{t('courierFix.shiftGoal.subtitle')}</div>
        </div>
      </header>

      {/* Earnings progress toward the monthly goal. */}
      <Card className="bg-gradient-to-br from-brand-700 to-brand-500 p-5 text-on-brand">
        <div className="text-xs font-semibold opacity-85">{t('courierFix.shiftGoal.earningsLabel')}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <Money amount={month} className="text-3xl font-extrabold tabular-nums" />
          <span className="text-sm opacity-85">/ <Money amount={MONTH_TARGET} /></span>
        </div>
        <div className="mt-3.5 h-2.5 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs font-bold">{t('courierFix.shiftGoal.percentDone', { pct })}</div>
      </Card>

      <div className="flex gap-2.5">
        <Card className="flex-1 p-3.5">
          <div className="text-xl font-extrabold tabular-nums">{delivered}</div>
          <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
            {t('courierFix.shiftGoal.deliveriesLabel', { target: deliveryTarget })}
          </div>
        </Card>
        <Card className="flex-1 p-3.5">
          <div className="text-xl font-extrabold tabular-nums">{remaining}</div>
          <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
            {t('courierFix.shiftGoal.remainingShift')}
          </div>
        </Card>
      </div>

      <div className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        {t('courierFix.shiftGoal.tiersHeading')}
      </div>
      <div className="flex flex-col gap-2.5">
        {TIERS.map((tier) => {
          const achieved = delivered >= tier.n;
          const isTarget = !achieved && TIERS.filter((x) => x.n > delivered).sort((a, b) => a.n - b.n)[0]?.n === tier.n;
          const short = tier.n - delivered;
          const amount = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(tier.bonus);
          return (
            <Card
              key={tier.n}
              className={`flex items-center gap-3 p-3.5 ${isTarget ? 'border-2 border-brand-600' : ''} ${!achieved && !isTarget ? 'opacity-70' : ''}`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold tabular-nums ${
                  achieved ? 'bg-green-100 text-green-700' : isTarget ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-[color:var(--muted)]'
                }`}
              >
                {achieved ? <Check size={17} weight="bold" /> : isTarget ? tier.n : <LockSimple size={16} weight="fill" />}
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-extrabold">{t('courierFix.shiftGoal.tierUnit', { n: tier.n })}</div>
                <div className={`text-[11.5px] ${achieved ? 'text-green-700' : isTarget ? 'text-brand-700' : 'text-[color:var(--muted)]'}`}>
                  {achieved
                    ? t('courierFix.shiftGoal.tierAchieved', { amount })
                    : isTarget
                      ? t('courierFix.shiftGoal.tierTarget', { amount, n: short })
                      : t('courierFix.shiftGoal.tierLocked', { amount })}
                </div>
              </div>
              {isTarget && (
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-extrabold text-brand-700">
                  {t('courierFix.shiftGoal.tierTargetBadge')}
                </span>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-3">
        <Lightning size={18} weight="fill" className="shrink-0 text-amber-600" />
        <span className="text-[11.5px] leading-snug text-amber-800">{t('courierFix.shiftGoal.peakHint')}</span>
      </div>
    </div>
  );
}

export default function DriverGoalPage() {
  return (
    <DriverShell nav={false}>
      <ShiftGoal />
    </DriverShell>
  );
}
