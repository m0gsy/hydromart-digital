'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SlidersHorizontal } from '@phosphor-icons/react';

import { Button, Card, Field, Input, Money, RadioCard, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { EMPTY_RULE_FORM, toRulePayload } from '@/lib/pricing';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page, Product } from '@/lib/types';

const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

type AdjustKind = 'percent' | 'nominal' | 'fixed';

/** Effective price = catalog base adjusted by the entered rule (mirrors checkout math). */
function preview(base: number, kind: AdjustKind, raw: number): number {
  const v = Number.isFinite(raw) ? raw : 0;
  const eff = kind === 'percent' ? base * (1 + v / 100) : kind === 'nominal' ? base + v : v;
  return Math.round(Math.max(0, eff));
}

// Design 21a — Aturan harga baru. Product/depot pickers and the save call are real
// (POST depot pricing rule). The backend adjustType is PERCENT|FIXED, so "Harga tetap"
// (absolute price) is sent as a FIXED delta of (target − base) — a real, exact mapping.
export default function HqPricingRuleFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();

  const catalog = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 50 })));
  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));

  const [productId, setProductId] = useState('');
  const [depotId, setDepotId] = useState('');
  const [kind, setKind] = useState<AdjustKind>('percent');
  const [value, setValue] = useState('');
  const [priority, setPriority] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = catalog.data?.items ?? [];
  const depotItems = depots.data?.items ?? [];
  const product = products.find((p) => p.id === productId) ?? null;
  const effective = product ? preview(product.basePrice, kind, Number(value)) : null;

  async function save() {
    if (!depotId) return setError(t('hq.forms.pricingRule.needDepot'));
    if (!productId) return setError(t('hq.forms.pricingRule.needProduct'));
    if (value.trim() === '' || !Number.isFinite(Number(value))) {
      return setError(t('hq.forms.pricingRule.needValue'));
    }

    // Map the 3-way UI onto the backend's PERCENT|FIXED. Fixed = absolute target price,
    // expressed as a FIXED delta from the catalog base.
    const adjustType = kind === 'percent' ? 'PERCENT' : 'FIXED';
    const ruleValue =
      kind === 'fixed' ? String(Number(value) - (product?.basePrice ?? 0)) : value;

    const parsed = toRulePayload({
      ...EMPTY_RULE_FORM,
      productId,
      adjustType,
      value: ruleValue,
      priority,
      validFrom,
      validUntil,
    });
    if (!parsed.ok) return setError(parsed.error);

    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.pricing.create(depotId), parsed.value, true);
      toast(t('hq.forms.pricingRule.saved'), 'success');
      router.push('/hq/pricing');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.forms.pricingRule.error'));
    } finally {
      setBusy(false);
    }
  }

  if (catalog.loading || depots.loading) return <Skeleton className="h-96 w-full" />;

  const KINDS: AdjustKind[] = ['percent', 'nominal', 'fixed'];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.forms.pricingRule.title')}</h1>
          <p className="text-sm text-muted">{t('hq.forms.pricingRule.subtitle')}</p>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hq.forms.pricingRule.product')} htmlFor="pr-product">
            <select id="pr-product" className={SELECT_CLASS} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t('hq.forms.pricingRule.pickProduct')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('hq.forms.pricingRule.depot')} htmlFor="pr-depot">
            <select id="pr-depot" className={SELECT_CLASS} value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">{t('hq.forms.pricingRule.pickDepot')}</option>
              {depotItems.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t('hq.forms.pricingRule.adjustType')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <RadioCard key={k} selected={kind === k} onSelect={() => setKind(k)}>
                <span className="font-semibold">{t(`hq.forms.pricingRule.${k}`)}</span>
              </RadioCard>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hq.forms.pricingRule.value')} htmlFor="pr-value">
            <Input id="pr-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'percent' ? '-10' : kind === 'nominal' ? '-2000' : '18000'} />
          </Field>
          <Field label={t('hq.forms.pricingRule.priority')} htmlFor="pr-priority">
            <Input id="pr-priority" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" />
          </Field>
          <Field label={t('hq.forms.pricingRule.from')} htmlFor="pr-from">
            <Input id="pr-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t('hq.forms.pricingRule.until')} htmlFor="pr-until">
            <Input id="pr-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>

        {/* Live effective-price preview (real, computed from catalog base). */}
        <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-800">
            {t('hq.forms.pricingRule.preview')}
          </span>
          <span className="text-lg font-bold tabular-nums text-brand-800">
            {effective == null ? t('hq.common.dash') : <Money amount={effective} />}
          </span>
        </div>

        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-app pt-3">
          <Button variant="ghost" onClick={() => router.push('/hq/pricing')} disabled={busy}>
            {t('hq.forms.cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('hq.forms.pricingRule.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
