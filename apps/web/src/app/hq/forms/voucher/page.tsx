'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ticket } from '@phosphor-icons/react';

import { Button, Card, Field, Input, RadioCard } from '@/components/ui';
import { useToast } from '@/components/toast';
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
  /*
   * CA-2-65: every HQ voucher was born immortal.
   *
   * `validFrom` and `validUntil` were HARDCODED to null in the payload — not defaulted,
   * not optional on a form that offered the choice: there was no expiry input at all. A
   * Ramadan promo published from this screen is still redeemable in December, and the only
   * way to stop one was to remember it exists and switch it off by hand.
   *
   * Empty stays null, which is what an open-ended voucher genuinely is. What changed is
   * that it is now a decision somebody made rather than one the form made for them.
   */
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  const discountType =
    kind === 'percent' ? 'PERCENTAGE' : kind === 'nominal' ? 'FIXED' : 'FREE_SHIPPING';

  // Build the create payload. `active:false` saves a draft. FREE_SHIPPING carries no
  // value (0); maxDiscount doubles as an optional shipping-subsidy cap.
  function buildPayload(active: boolean): VoucherPayload {
    return {
      code: code.trim().toUpperCase(),
      description: null,
      discountType,
      value: kind === 'freeShip' ? 0 : Number(value),
      minSpend: num(minOrder) ?? 0,
      maxDiscount: kind === 'nominal' ? null : (num(maxDiscount) ?? null),
      // A date input gives `YYYY-MM-DD`; the window runs from the START of the first day
      // to the END of the last, in the business timezone — an expiry of "31 Des" that
      // stops at midnight UTC would kill the voucher at 07:00 on the 31st in Jakarta.
      validFrom: validFrom ? `${validFrom}T00:00:00+07:00` : null,
      validUntil: validUntil ? `${validUntil}T23:59:59+07:00` : null,
      usageLimit: num(quota) ?? null,
      perCustomerLimit: num(perUser) ?? 1,
      budgetCap: num(budget) ?? null,
      active,
    };
  }

  async function submit(active: boolean) {
    if (!code.trim()) return setError(t('hq.forms.voucher.needCode'));
    if (kind !== 'freeShip' && (value.trim() === '' || Number(value) <= 0)) {
      return setError(t('hq.forms.voucher.needValue'));
    }
    // The server refuses this too (CA-2-65). Saying so here names the field.
    if (kind === 'percent' && Number(value) > 100) {
      return setError(t('hq.forms.voucher.percentTooHigh'));
    }
    if (validFrom && validUntil && validUntil < validFrom) {
      return setError(t('hq.forms.voucher.endBeforeStart'));
    }

    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.vouchers.create, buildPayload(active), true);
      toast(
        t(active ? 'hq.forms.voucher.published' : 'hq.forms.voucher.draftSaved'),
        active ? 'success' : 'info',
      );
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
          <Input
            id="v-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="HEMAT10"
          />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t('hq.forms.voucher.type')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <RadioCard key={k} selected={kind === k} onSelect={() => setKind(k)}>
                <span className="flex items-center gap-1.5 font-semibold">
                  {t(`hq.forms.voucher.${k}`)}
                </span>
              </RadioCard>
            ))}
          </div>
        </div>

        {kind !== 'freeShip' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('hq.forms.voucher.value')} htmlFor="v-value">
              <Input
                id="v-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === 'percent' ? '10' : '5000'}
              />
            </Field>
            {kind === 'percent' && (
              <Field label={t('hq.forms.voucher.maxDiscount')} htmlFor="v-max">
                <Input
                  id="v-max"
                  type="number"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                  placeholder="20000"
                />
              </Field>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hq.forms.voucher.minOrder')} htmlFor="v-min">
            <Input
              id="v-min"
              type="number"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              placeholder="50000"
            />
          </Field>
          <Field label={t('hq.forms.voucher.quota')} htmlFor="v-quota">
            <Input
              id="v-quota"
              type="number"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              placeholder="1000"
            />
          </Field>
          <Field label={t('hq.forms.voucher.perUser')} htmlFor="v-per">
            <Input
              id="v-per"
              type="number"
              value={perUser}
              onChange={(e) => setPerUser(e.target.value)}
              placeholder="1"
            />
          </Field>
          <Field label={t('hq.forms.voucher.budget')} htmlFor="v-budget">
            <Input
              id="v-budget"
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="5000000"
            />
          </Field>
          <Field
            label={t('hq.forms.voucher.validFrom')}
            htmlFor="v-from"
            hint={t('hq.forms.voucher.validHint')}
          >
            <Input
              id="v-from"
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </Field>
          <Field label={t('hq.forms.voucher.validUntil')} htmlFor="v-until">
            <Input
              id="v-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
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
