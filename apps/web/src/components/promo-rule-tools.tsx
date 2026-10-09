'use client';

import { useState } from 'react';

import { DepotSelect, useProductList } from '@/components/catalog-select';
import { KIND_KEY, PROMO_KINDS } from '@/components/promo-rule-kind-fields';
import { Badge, Button, Card, Field, FormError, Input, Money } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { EMPTY_RULE_FILTER, type RuleFilter, isFiltering } from '@/lib/promo-rule-filter';
import { useAsync } from '@/lib/use-async';
import type { PromoRule, PromoRuleChannel, PromoRuleKind, PromoRuleUsage, PromoSimulation } from '@/lib/types';

/*
 * Admin tools around the promo-rule list, shared by /hq/promo-rules and /dashboard/promo-rules:
 * find a rule, see whether it ever fires, and try a basket against the active rules before a
 * customer does. Their copy lives under `hq.promoTools` for both consoles.
 */
const SELECT_CLASS = 'w-full rounded-lg border border-app bg-surface px-3 py-2.5 text-sm';
// The filter row sits beside the search box, so its selects are content-width (a `w-auto` next to
// `w-full` is decided by stylesheet order, and full width won: three stacked full-width rows).
const FILTER_SELECT_CLASS = 'w-auto rounded-lg border border-app bg-surface px-3 py-2.5 text-sm';

export function RuleFilterBar({ value, onChange }: { value: RuleFilter; onChange: (next: RuleFilter) => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[12rem] flex-1">
        <Input
          aria-label={t('hq.promoTools.search')}
          placeholder={t('hq.promoTools.search')}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      </div>
      <select
        aria-label={t('hq.promoTools.kindFilter')}
        className={FILTER_SELECT_CLASS}
        value={value.kind}
        onChange={(e) => onChange({ ...value, kind: e.target.value as PromoRuleKind | '' })}
      >
        <option value="">{t('hq.promoTools.allKinds')}</option>
        {PROMO_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`hq.promoRules.fields.${KIND_KEY[kind]}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t('hq.promoTools.statusFilter')}
        className={FILTER_SELECT_CLASS}
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as RuleFilter['status'] })}
      >
        <option value="all">{t('hq.promoTools.allStatuses')}</option>
        <option value="active">{t('hq.promoTools.onlyActive')}</option>
        <option value="inactive">{t('hq.promoTools.onlyInactive')}</option>
      </select>
      {isFiltering(value) && (
        <Button variant="ghost" onClick={() => onChange(EMPTY_RULE_FILTER)}>
          {t('hq.promoTools.clear')}
        </Button>
      )}
    </div>
  );
}

/**
 * Usage per rule id. A failed read gives `null`, and the list simply shows no usage: the audit
 * trail is a nicety next to the rules themselves, never a reason to blank the page.
 */
export function useRuleUsage(): Map<string, PromoRuleUsage> | null {
  const { data } = useAsync<PromoRuleUsage[]>(() => api.get<PromoRuleUsage[]>(endpoints.promoRules.usage, true), []);
  return Array.isArray(data) ? new Map(data.map((u) => [u.promoRuleId, u])) : null;
}

export function RuleUsageLine({ usages, ruleId }: { usages: Map<string, PromoRuleUsage> | null; ruleId: string }) {
  const { t } = useT();
  if (usages === null) return null;
  const usage = usages.get(ruleId);
  if (!usage) return <span className="text-xs text-muted">{t('hq.promoTools.neverUsed')}</span>;
  return (
    <span className="text-xs text-muted">
      {t('hq.promoTools.usedOrders', { count: usage.orders })} · <Money amount={usage.totalDiscount} />
      {usage.lastAppliedAt ? ` · ${t('hq.promoTools.lastUsed', { at: formatDateTime(usage.lastAppliedAt) })}` : ''}
    </span>
  );
}

interface SimLine {
  productId: string;
  quantity: string;
}

/**
 * "Coba rule": a basket, a depot, a channel and a moment go to the same quote the checkout uses
 * and the answer is shown, with the rule names resolved. Nothing is recorded. Prices are the
 * catalogue's, since the depot's own price is not what a rule is judged on.
 */
export function PromoSimulator({
  rules,
  fixedDepotId,
}: {
  rules: PromoRule[];
  /** The depot console pins the depot; the HQ console lets the operator choose (or none). */
  fixedDepotId?: string | null;
}) {
  const { t } = useT();
  const products = useProductList().data ?? [];
  const [open, setOpen] = useState(false);
  const [depotId, setDepotId] = useState('');
  const [channel, setChannel] = useState<PromoRuleChannel>('APP');
  const [when, setWhen] = useState('');
  const [firstOrder, setFirstOrder] = useState(false);
  const [lines, setLines] = useState<SimLine[]>([{ productId: '', quantity: '1' }]);
  const [result, setResult] = useState<PromoSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const productById = new Map(products.map((p) => [p.id, p]));
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? id;
  const effectiveDepot = fixedDepotId !== undefined ? fixedDepotId : depotId || null;

  const setLine = (i: number, patch: Partial<SimLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function run() {
    const filled = lines.filter((l) => l.productId);
    const bad = filled.some((l) => !/^\d+$/.test(l.quantity.trim()) || Number(l.quantity) < 1);
    if (filled.length === 0 || bad) {
      setError(t('hq.promoTools.needLines'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answer = await api.post<PromoSimulation>(
        endpoints.promoRules.simulate,
        {
          depotId: effectiveDepot ?? undefined,
          channel,
          occurredAt: when ? new Date(when).toISOString() : undefined,
          firstOrder,
          lines: filled.map((l) => {
            const product = productById.get(l.productId);
            return {
              productId: l.productId,
              categoryId: product?.categoryId ?? undefined,
              quantity: Number(l.quantity),
              unitPrice: product?.basePrice ?? 0,
            };
          }),
        },
        true,
      );
      setResult(answer);
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : t('hq.promoTools.simulateError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('hq.promoTools.openSimulator')}
        </Button>
      </div>
    );
  }

  const anyApplied =
    result !== null &&
    (result.lines.some((l) => l.appliedRuleIds.length > 0 || l.freeQty > 0) ||
      result.orderDiscountAmount > 0 ||
      result.shippingFeeOverride !== null ||
      result.gifts.length > 0);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('hq.promoTools.simulatorTitle')}</h2>
          <p className="text-sm text-muted">{t('hq.promoTools.simulatorHint')}</p>
        </div>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('hq.promoTools.close')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fixedDepotId === undefined && (
          <Field label={t('hq.promoTools.depot')}>
            <DepotSelect value={depotId} onChange={setDepotId} emptyLabel={t('hq.promoTools.networkOnly')} />
          </Field>
        )}
        <Field label={t('hq.promoTools.channel')}>
          <select className={SELECT_CLASS} value={channel} onChange={(e) => setChannel(e.target.value as PromoRuleChannel)}>
            <option value="APP">{t('hq.promoTools.channelApp')}</option>
            <option value="COUNTER">{t('hq.promoTools.channelCounter')}</option>
          </select>
        </Field>
        <Field label={t('hq.promoTools.when')} hint={t('hq.promoTools.whenHint')}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label={t('hq.promoTools.newCustomer')}>
          <label className="flex items-center gap-2 py-2 text-sm">
            <input type="checkbox" checked={firstOrder} onChange={(e) => setFirstOrder(e.target.checked)} />
            {t('hq.promoTools.newCustomer')}
          </label>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('hq.promoTools.basket')}</p>
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <select
                aria-label={t('hq.promoTools.product')}
                className={SELECT_CLASS}
                value={line.productId}
                onChange={(e) => setLine(i, { productId: e.target.value })}
              >
                <option value="">{t('hq.promoTools.pickProduct')}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <Input
                aria-label={t('hq.promoTools.qty')}
                type="number"
                value={line.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
              />
            </div>
            {lines.length > 1 && (
              <Button variant="ghost" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                {t('hq.promoTools.removeLine')}
              </Button>
            )}
          </div>
        ))}
        <div>
          <Button variant="ghost" onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '1' }])}>
            {t('hq.promoTools.addLine')}
          </Button>
        </div>
      </div>

      <FormError message={error} />
      <div>
        <Button onClick={run} loading={busy}>
          {t('hq.promoTools.run')}
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-2 rounded-lg border border-app p-4" aria-live="polite">
          {!anyApplied && <p className="text-sm text-muted">{t('hq.promoTools.nothingApplied')}</p>}
          {result.lines.map((line, i) => {
            const name = productById.get(line.productId)?.name ?? line.productId;
            const original = productById.get(line.productId)?.basePrice ?? line.unitPriceAfter;
            const touched = line.appliedRuleIds.length > 0 || line.freeQty > 0;
            return (
              <div key={`${line.productId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{name}</span>
                {touched ? (
                  <>
                    <span>
                      <Money amount={original} /> → <Money amount={line.unitPriceAfter} />
                    </span>
                    {line.freeQty > 0 && <Badge tone="success">{t('hq.promoTools.freeUnits', { count: line.freeQty })}</Badge>}
                    {line.appliedRuleIds.map((id) => (
                      <Badge key={id} tone="neutral">
                        {ruleName(id)}
                      </Badge>
                    ))}
                  </>
                ) : (
                  <span className="text-muted">{t('hq.promoTools.noRule')}</span>
                )}
              </div>
            );
          })}
          {result.orderDiscountAmount > 0 && result.orderDiscountRuleId && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{t('hq.promoTools.orderDiscount')}</span>
              <span>
                −<Money amount={result.orderDiscountAmount} />
              </span>
              <Badge tone="neutral">{ruleName(result.orderDiscountRuleId)}</Badge>
            </div>
          )}
          {result.shippingFeeOverride !== null && result.shippingAppliedRuleId && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{t('hq.promoTools.shipping')}</span>
              <span>{t('hq.promoTools.perGalon')} <Money amount={result.shippingFeeOverride} /></span>
              <Badge tone="neutral">{ruleName(result.shippingAppliedRuleId)}</Badge>
            </div>
          )}
          {result.gifts.map((g, i) => (
            <div key={`${g.productId}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{t('hq.promoTools.gift')}</span>
              <span>
                {g.quantity}× {productById.get(g.productId)?.name ?? g.productId}
              </span>
              <Badge tone="neutral">{ruleName(g.promoRuleId)}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
