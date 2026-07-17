'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ticket } from '@phosphor-icons/react';

import { Button, Card, Field, Input, RadioCard } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { VoucherPayload } from '@/lib/types';

type VoucherKind = 'percent' | 'nominal' | 'freeShip';

// Design 21b — Voucher baru. Publish is real for Persen/Nominal (POST vouchers, payload
// mirrors dashboard/vouchers). The backend has no "free shipping" discountType nor a
// budget field, so "Gratis ongkir" + "Anggaran maksimum" + "Simpan draf" are stubbed.
export default function HqVoucherFormPage() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();

  const [code, setCode] = useState('');
  const [kind, setKind] = useState<VoucherKind>('percent');
  const [value, setValue] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [quota, setQuota] = useState('');
  const [perUser, setPerUser] = useState('1');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  // Build the create payload for percent/nominal vouchers. `active:false` saves a draft.
  function buildPayload(active: boolean): VoucherPayload {
    return {
      code: code.trim().toUpperCase(),
      description: null,
      discountType: kind === 'percent' ? 'PERCENTAGE' : 'FIXED',
      value: Number(value),
      minSpend: num(minOrder) ?? 0,
      maxDiscount: kind === 'percent' ? num(maxDiscount) ?? null : null,
      validFrom: null,
      validUntil: null,
      usageLimit: num(quota) ?? null,
      perCustomerLimit: num(perUser) ?? 1,
      budgetCap: num(budget) ?? null,
      active,
    };
  }

  async function submit(active: boolean) {
    if (!code.trim()) return setError(t('hq.forms.voucher.needCode'));

    // Free shipping has no backend representation → stub publish.
    if (kind === 'freeShip') {
      toast(t('hq.forms.voucher.published'), 'success');
      router.push('/hq/vouchers');
      return;
    }
    if (value.trim() === '' || Number(value) <= 0) return setError(t('hq.forms.voucher.needValue'));

    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.vouchers.create, buildPayload(active), true);
      toast(t(active ? 'hq.forms.voucher.published' : 'hq.forms.voucher.draftSaved'), active ? 'success' : 'info');
      router.push('/hq/vouchers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.forms.voucher.error'));
    } finally {
      setBusy(false);
    }
  }

  const KINDS: VoucherKind[] = ['percent', 'nominal', 'freeShip'];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Ticket size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('hq.forms.voucher.title')}</h1>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <Field label={t('hq.forms.voucher.code')} htmlFor="v-code" hint="HEMAT10">
          <Input id="v-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="HEMAT10" />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t('hq.forms.voucher.type')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <RadioCard key={k} selected={kind === k} onSelect={() => setKind(k)}>
                <span className="flex items-center gap-1.5 font-semibold">
                  {t(`hq.forms.voucher.${k}`)}
                  {k === 'freeShip' && <StubBadge />}
                </span>
              </RadioCard>
            ))}
          </div>
        </div>

        {kind !== 'freeShip' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('hq.forms.voucher.value')} htmlFor="v-value">
              <Input id="v-value" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'percent' ? '10' : '5000'} />
            </Field>
            {kind === 'percent' && (
              <Field label={t('hq.forms.voucher.maxDiscount')} htmlFor="v-max">
                <Input id="v-max" type="number" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} placeholder="20000" />
              </Field>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hq.forms.voucher.minOrder')} htmlFor="v-min">
            <Input id="v-min" type="number" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="50000" />
          </Field>
          <Field label={t('hq.forms.voucher.quota')} htmlFor="v-quota">
            <Input id="v-quota" type="number" value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="1000" />
          </Field>
          <Field label={t('hq.forms.voucher.perUser')} htmlFor="v-per">
            <Input id="v-per" type="number" value={perUser} onChange={(e) => setPerUser(e.target.value)} placeholder="1" />
          </Field>
          <Field label={t('hq.forms.voucher.budget')} htmlFor="v-budget">
            <Input id="v-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000000" />
          </Field>
        </div>

        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-app pt-3">
          <Button variant="secondary" onClick={() => submit(false)} disabled={busy}>
            {t('hq.forms.voucher.saveDraft')}
          </Button>
          <Button onClick={() => submit(true)} loading={busy}>
            {t('hq.forms.voucher.publish')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
