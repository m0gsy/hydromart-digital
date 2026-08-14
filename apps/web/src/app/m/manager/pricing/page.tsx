'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import { Tag } from '@phosphor-icons/react';

import { Card, CenterState, ErrorState, Skeleton, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import type { PricingRule } from '@/lib/types';

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function minutesToHHMM(m: number | null): string {
  if (m == null) return '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// `t` is a parameter, not a hook call: this is a plain formatter, and rules-of-hooks is
// right that a hook has no business here.
function windowSummary(r: PricingRule, t: (key: string) => string): string {
  const days = r.daysOfWeek.length === 0 ? t('hrFix.managerPricing.everyDay') : r.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ');
  const time =
    r.startMinute == null && r.endMinute == null
      ? t('hrFix.managerPricing.allDay')
      : `${minutesToHHMM(r.startMinute) || '00:00'}–${minutesToHHMM(r.endMinute) || '24:00'}`;
  return `${days} · ${time}`;
}

function adjustmentLabel(r: PricingRule): string {
  return r.adjustType === 'PERCENT' ? `${r.value}%` : formatIDR(r.value);
}

function RuleRow({ rule, depotId }: { rule: PricingRule; depotId: string }) {
  const { t } = useT();
  const [on, setOn] = useState(rule.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setOn(next); // optimistic
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.pricing.detail(depotId, rule.id), { active: next }, true);
    } catch (err) {
      setOn(!next); // revert
      setError(err instanceof ApiError ? err.message : t('hrFix.managerPricing.updateFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-extrabold">{rule.productId ?? t('hrFix.managerPricing.allProducts')}</p>
          <span className="shrink-0 text-sm font-extrabold tabular-nums text-brand-700">
            {adjustmentLabel(rule)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[color:var(--text-muted)]">{windowSummary(rule, t)}</p>
        {error && <p className="mt-1 text-[11px] font-medium text-red-600">{error}</p>}
      </div>
      <Toggle on={on} onChange={toggle} disabled={busy} label={`Aktifkan aturan ${rule.id}`} />
    </Card>
  );
}

export default function ManagerPricingPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { scopedId, ready, depots } = useDepot();
  const depotId = scopedId ?? customer?.assignedDepotId ?? '';

  const rules = useAsync<PricingRule[]>(
    () => (depotId ? api.get(endpoints.pricing.rules(depotId), true) : Promise.resolve([])),
    [depotId],
  );

  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.managerPricing.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          {t('hrFix.managerPricing.subtitle')}
        </p>
      </header>

      {ready && depots.length === 0 && !depotId ? (
        <CenterState icon={<Tag size={32} />} title={t('hrFix.managerPricing.noDepot')}>
          {t('hrFix.managerPricing.noDepots2')}
        </CenterState>
      ) : rules.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rules.error ? (
        <ErrorState message={rules.error} onRetry={rules.reload} />
      ) : !rules.data || rules.data.length === 0 ? (
        <CenterState icon={<Tag size={32} />} title={t('hrFix.managerPricing.empty')}>
          {t('hrFix.managerPricing.emptyBody2')}
        </CenterState>
      ) : (
        <div className="space-y-2.5">
          {rules.data.map((r) => (
            <RuleRow key={r.id} rule={r} depotId={depotId} />
          ))}
        </div>
      )}
    </div>
  );
}
