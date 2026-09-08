'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import { Tag } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { Card, CenterState, ErrorState, FormError, Skeleton, Toggle } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { formatIDR, shortWeekdays } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import type { PricingRule, Product } from '@/lib/types';

function minutesToHHMM(m: number | null): string {
  if (m == null) return '';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// `t` is a parameter, not a hook call: this is a plain formatter, and rules-of-hooks is
// right that a hook has no business here.
function windowSummary(r: PricingRule, t: (key: string) => string, locale: string): string {
  const DAY_LABELS = shortWeekdays(locale, false);
  const days =
    r.daysOfWeek.length === 0
      ? t('hrFix.managerPricing.everyDay')
      : r.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ');
  const time =
    r.startMinute == null && r.endMinute == null
      ? t('hrFix.managerPricing.allDay')
      : `${minutesToHHMM(r.startMinute) || '00:00'}–${minutesToHHMM(r.endMinute) || '24:00'}`;
  return `${days} · ${time}`;
}

function adjustmentLabel(r: PricingRule): string {
  return r.adjustType === 'PERCENT' ? `${r.value}%` : formatIDR(r.value);
}

function RuleRow({
  rule,
  depotId,
  productName,
}: {
  rule: PricingRule;
  depotId: string;
  productName: string;
}) {
  const { t, locale } = useT();
  const { confirm } = useConfirm();
  const [on, setOn] = useState(rule.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    /*
     * CA-4-40 — one tap on a phone switched an HQ-approved price rule off, or back on,
     * with no question. The control is a switch inside a scrolling list, so the tap that
     * does it is the same gesture as the tap that scrolls past it, and the effect is on
     * the price every customer of this depot is quoted from that second on.
     */
    const ok = await confirm({
      title: next
        ? t('hrFix.managerPricing.enableTitle')
        : t('hrFix.managerPricing.disableTitle'),
      message: t(
        next ? 'hrFix.managerPricing.enableConfirm' : 'hrFix.managerPricing.disableConfirm',
        { rule: adjustmentLabel(rule) },
      ),
      tone: next ? 'primary' : 'danger',
    });
    if (!ok) return;
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
          <p className="truncate text-sm font-extrabold">{productName}</p>
          <span className="shrink-0 text-sm font-extrabold tabular-nums text-brand-700">
            {adjustmentLabel(rule)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[color:var(--text-muted)]">
          {windowSummary(rule, t, locale)}
        </p>
        <FormError message={error} className="mt-1 text-[11px]" />
      </div>
      <Toggle
        on={on}
        onChange={toggle}
        disabled={busy}
        label={t('hrFix.managerPricing.toggleLabel', { product: productName })}
      />
    </Card>
  );
}

export default function ManagerPricingPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { scopedId, ready, depots, error: depotsError, reload: reloadDepots } = useDepot();
  const depotId = scopedId ?? customer?.assignedDepotId ?? '';

  const rules = useAsync<PricingRule[]>(
    () => (depotId ? api.get(endpoints.pricing.rules(depotId), true) : Promise.resolve([])),
    [depotId],
  );

  /*
   * CA-4-43 — this list named each rule by `rule.productId`, a raw UUID, so the manager
   * was toggling "8f3c1a90-…" on and off and had no way to tell which product's price
   * they had just changed. Every id in one batch call, then id -> name below.
   *
   * `batch` answers with ACTIVE products only, so a rule pointing at a deactivated one
   * resolves to nothing; that case gets its own label rather than falling back to the
   * UUID this row exists to remove.
   */
  const productIds = [
    ...new Set((rules.data ?? []).map((r) => r.productId).filter((id): id is string => !!id)),
  ].sort();
  const key = productIds.join(',');
  const products = useAsync<Product[]>(
    () => (key ? api.getCached(endpoints.products.batch(key.split(','))) : Promise.resolve([])),
    [key],
  );
  const names = new Map((products.data ?? []).map((p) => [p.id, p.name]));

  function nameFor(rule: PricingRule): string {
    if (!rule.productId) return t('hrFix.managerPricing.allProducts');
    return names.get(rule.productId) ?? t('hrFix.managerPricing.inactiveProduct');
  }

  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.managerPricing.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          {t('hrFix.managerPricing.subtitle')}
        </p>
      </header>

      {/*
        CA-4-10: "belum ada depot" is an answer, and a failed load is not one.
        `depots.length === 0` is true both when the manager really has no depot AND when
        the depot list could not be read at all — so an outage told a manager their depot
        did not exist, on the screen that sets prices. The two are told apart now, and the
        failure gets a retry rather than a shrug.
      */}
      {depotsError ? (
        <ErrorState message={depotsError} onRetry={reloadDepots} />
      ) : ready && depots.length === 0 && !depotId ? (
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
            <RuleRow key={r.id} rule={r} depotId={depotId} productName={nameFor(r)} />
          ))}
        </div>
      )}
    </div>
  );
}
