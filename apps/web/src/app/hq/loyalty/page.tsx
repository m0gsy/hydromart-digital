'use client';

import { useState } from 'react';
import { Crown, Gift } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useLoyaltyRules } from '@/lib/loyalty-rules';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { RewardItem, TierBenefit } from '@/lib/types';

// Design 18b — loyalty program. Real: loyalty.tiers + rewards.catalog + loyalty.rules.
//
// The earn rate was written here as "Rp 1.000", described in this comment as "a fixed
// program constant". It is not one: `earnRateRupiah` is a per-depot setting, and this is
// the HQ screen an operator reads before going to Pengaturan to change it. It now reads
// the value, network-wide, from the same accessor the earning arithmetic uses.
export default function HqLoyaltyPage() {
  const { t } = useT();
  // No depot arg: HQ looks at the network-wide ladder. Per-depot overrides are edited
  // in Pengaturan, scoped to their depot.
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers()));
  /*
   * PAR-04: `rewards.items`, not `rewards.catalog`.
   *
   * `catalog` is the customer-facing read - active rows only. This screen is where a
   * retired reward is brought back, and a row you cannot see is a row you cannot restore.
   * The three management routes (list-all, create, patch) were all built for design 15c and
   * reachable from nowhere, so the table could only be edited with SQL - which is exactly
   * what the controller's own comment says they were written to end.
   */
  const rewards = useAsync<RewardItem[]>(() => api.get(endpoints.rewards.items, true));
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', unit: '', pointsCost: '', stock: '' });

  async function patchItem(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    try {
      await api.patch(endpoints.rewards.updateItem(id), patch, true);
      toast(t('hq.loyalty.itemSaved'), 'success');
      rewards.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.loyalty.itemSaveError'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function addItem() {
    setBusy('new');
    try {
      await api.post(
        endpoints.rewards.items,
        {
          name: draft.name.trim(),
          unit: draft.unit.trim(),
          pointsCost: Number(draft.pointsCost),
          // Blank means unlimited, and null is how the column says so. Sending 0 would
          // create a reward that is sold out the moment it exists.
          stock: draft.stock.trim() === '' ? null : Number(draft.stock),
        },
        true,
      );
      toast(t('hq.loyalty.itemCreated'), 'success');
      setDraft({ name: '', unit: '', pointsCost: '', stock: '' });
      rewards.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.loyalty.itemCreateError'), 'error');
    } finally {
      setBusy(null);
    }
  }

  const canAdd =
    draft.name.trim() !== '' && draft.unit.trim() !== '' && Number(draft.pointsCost) > 0;
  // No depot arg, same as `tiers`: HQ states the network-wide rule.
  const rules = useLoyaltyRules();

  const ladder = [...(tiers.data ?? [])].sort((a, b) => a.threshold - b.threshold);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Crown} title={t('hq.loyalty.title')} subtitle={t('hq.loyalty.subtitle')} />

      {/* Tiers — REAL */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t('hq.loyalty.tiers')}</h2>
        {/* No rate read, no sentence: a note that invents a number is worse than no note. */}
        {rules.data && (
          <p className="text-xs text-muted">
            {t('hq.loyalty.earnNote', { amount: formatIDR(rules.data.earnRateRupiah) })}
          </p>
        )}
        {tiers.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : tiers.error ? (
          <ErrorState message={tiers.error} onRetry={tiers.reload} />
        ) : ladder.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('hq.loyalty.tiersEmpty')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ladder.map((tier) => (
              <div key={tier.tier} className="flex flex-col gap-1 rounded-xl border border-app p-4">
                <span className="text-sm font-bold">{tier.tier}</span>
                <span className="text-xs text-muted">
                  {t('hq.loyalty.threshold')}: {tier.threshold.toLocaleString('id-ID')}
                </span>
                <span className="mt-1 text-lg font-bold tabular-nums text-brand-700">
                  {Math.round(tier.discountRate * 100)}%
                </span>
                <span className="text-xs text-muted">{t('hq.loyalty.discount')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Rewards — REAL */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gift size={18} weight="fill" className="text-brand-500" />
          {t('hq.loyalty.rewards')}
        </h2>
        {rewards.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : rewards.error ? (
          <ErrorState message={rewards.error} onRetry={rewards.reload} />
        ) : !rewards.data || rewards.data.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('hq.loyalty.rewardsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {rewards.data.map((r) => {
              const out = r.stock !== null && r.stock <= 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-1 text-xs text-muted">/ {r.unit}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {r.active === false && (
                      <span className="rounded-full bg-[color:var(--surface-soft)] px-2.5 py-0.5 text-xs font-bold text-muted">
                        {t('hq.loyalty.retiredBadge')}
                      </span>
                    )}
                    {out && (
                      <span className="rounded-full bg-[color:var(--surface-soft)] px-2.5 py-0.5 text-xs font-bold text-muted">
                        {t('hq.loyalty.soldOut')}
                      </span>
                    )}
                    <span className="font-bold tabular-nums text-brand-700">
                      {t('hq.loyalty.points', { n: r.pointsCost.toLocaleString('id-ID') })}
                    </span>
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void patchItem(r.id, { active: r.active === false })}
                    >
                      {r.active === false ? t('hq.loyalty.restore') : t('hq.loyalty.retire')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* PAR-04: the half that did not exist. Add is the only shape that needs a form -
            editing points/stock on an existing row goes through the same PATCH the retire
            button uses, so there is one write path and not two. */}
        <div className="mt-2 flex flex-col gap-3 rounded-xl border border-app p-4">
          <div>
            <h3 className="text-sm font-bold">{t('hq.loyalty.manage')}</h3>
            <p className="text-xs text-muted">{t('hq.loyalty.manageHint')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('hq.loyalty.itemName')}>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label={t('hq.loyalty.itemUnit')}>
              <Input
                value={draft.unit}
                onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              />
            </Field>
            <Field label={t('hq.loyalty.itemPoints')}>
              <Input
                type="number"
                inputMode="numeric"
                value={draft.pointsCost}
                onChange={(e) => setDraft({ ...draft, pointsCost: e.target.value })}
              />
            </Field>
            <Field label={t('hq.loyalty.itemStock')}>
              <Input
                type="number"
                inputMode="numeric"
                value={draft.stock}
                onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
              />
            </Field>
          </div>
          <Button
            className="sm:self-start"
            disabled={!canAdd || busy !== null}
            onClick={() => void addItem()}
          >
            {t('hq.loyalty.addItem')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
