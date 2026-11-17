'use client';

import { useState } from 'react';

import { CategorySelect, DepotSelect, ProductSelect } from '@/components/catalog-select';
import { Button, Field, FormError, Input, RadioCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { DiscountType, Voucher } from '@/lib/types';
import {
  emptyVoucherForm,
  voucherFormFrom,
  voucherFormProblem,
  voucherFormToPayload,
  type VoucherAudience,
  type VoucherForm as Form,
} from '@/lib/voucher-form';

const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

const KINDS: { type: DiscountType; key: string }[] = [
  { type: 'PERCENTAGE', key: 'percent' },
  { type: 'FIXED', key: 'nominal' },
  { type: 'FREE_SHIPPING', key: 'freeShip' },
];

const AUDIENCES: { value: VoucherAudience; key: string }[] = [
  { value: 'PUBLIC', key: 'audiencePublic' },
  { value: 'GRANTED', key: 'audienceGranted' },
];

/**
 * The one voucher editor (see lib/voucher-form.ts for why there is only one now).
 *
 * `ownDepots` is the difference between the two kinds of author. A depot-scoped author (MANAGER)
 * passes the depots they run and must pick one of them — the server refuses a network code from
 * them. Head office passes nothing and may pick any depot, or none for the whole network.
 */
export function VoucherForm({
  voucher,
  ownDepots,
  defaultDepotId = '',
  allowDraft = false,
  onDone,
  onCancel,
}: {
  voucher: Voucher | null;
  ownDepots?: readonly { id: string; name: string }[];
  defaultDepotId?: string;
  /** Head office's create page offers "Simpan draf" (saved switched off) beside publishing. */
  allowDraft?: boolean;
  onDone: (saved: { active: boolean }) => void;
  onCancel?: () => void;
}) {
  const { t } = useT();
  const T = (k: string, vars?: Record<string, string | number>) => t(`hq.forms.voucher.${k}`, vars);
  const mode = voucher ? 'edit' : 'create';
  const [form, setForm] = useState<Form>(() =>
    voucher ? voucherFormFrom(voucher) : emptyVoucherForm(ownDepots ? defaultDepotId : ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set =
    <K extends keyof Form>(k: K) =>
    (value: Form[K]) =>
      setForm((f) => ({ ...f, [k]: value }));
  const text = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(active: boolean) {
    const next = { ...form, active: mode === 'create' ? active : form.active };
    const problem = voucherFormProblem(next, mode, Boolean(ownDepots));
    if (problem) return setError(T(problem));
    setBusy(true);
    setError(null);
    try {
      if (voucher) {
        await api.patch(
          endpoints.vouchers.detail(voucher.id),
          { ...voucherFormToPayload(next, 'edit'), seenUpdatedAt: voucher.updatedAt },
          true,
        );
      } else {
        await api.post(endpoints.vouchers.create, voucherFormToPayload(next, 'create'), true);
      }
      onDone({ active: next.active });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : T('error'));
    } finally {
      setBusy(false);
    }
  }

  const goods = form.discountType !== 'FREE_SHIPPING';

  return (
    <div className="flex flex-col gap-4">
      {voucher && <h2 className="text-lg font-bold">{T('editTitle', { code: voucher.code })}</h2>}

      {!voucher && (
        <Field label={T('code')} htmlFor="vf-code" hint={T('codeHint')}>
          <Input id="vf-code" value={form.code} onChange={text('code')} placeholder="HEMAT10" />
        </Field>
      )}
      <Field label={T('description')} htmlFor="vf-description" hint={T('descriptionHint')}>
        <Input id="vf-description" value={form.description} onChange={text('description')} />
      </Field>

      {/* Who may spend it. Without this every code was public, and "Beri" handed a customer
          a code anybody else could type as well. */}
      <div>
        <p className="mb-1.5 text-sm font-medium">{T('audience')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIENCES.map((a) => (
            <RadioCard key={a.value} selected={form.audience === a.value} onSelect={() => set('audience')(a.value)}>
              <span className="block font-semibold">{T(a.key)}</span>
              <span className="mt-0.5 block text-xs text-muted">{T(`${a.key}Hint`)}</span>
            </RadioCard>
          ))}
        </div>
      </div>

      {/* Where it may be spent. A depot-scoped author picks among their own depots only. */}
      <Field label={T('depot')} htmlFor="vf-depot" hint={ownDepots ? T('depotHintOwn') : T('depotHintHq')}>
        {ownDepots ? (
          <select
            id="vf-depot"
            className={SELECT_CLASS}
            value={form.depotId}
            onChange={(e) => set('depotId')(e.target.value)}
          >
            <option value="">{T('depotPick')}</option>
            {ownDepots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <DepotSelect id="vf-depot" value={form.depotId} onChange={set('depotId')} emptyLabel={T('depotAll')} />
        )}
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-medium">{T('type')}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <RadioCard key={k.type} selected={form.discountType === k.type} onSelect={() => set('discountType')(k.type)}>
              <span className="font-semibold">{T(k.key)}</span>
            </RadioCard>
          ))}
        </div>
      </div>

      {goods && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={T('value')} htmlFor="vf-value" hint={form.discountType === 'PERCENTAGE' ? '1–100' : T('valueRupiahHint')}>
            <Input
              id="vf-value"
              type="number"
              value={form.value}
              onChange={text('value')}
              placeholder={form.discountType === 'PERCENTAGE' ? '10' : '5000'}
            />
          </Field>
          {form.discountType === 'PERCENTAGE' && (
            <Field label={T('maxDiscount')} htmlFor="vf-max">
              <Input id="vf-max" type="number" value={form.maxDiscount} onChange={text('maxDiscount')} placeholder="20000" />
            </Field>
          )}
          <Field label={T('scopeProduct')} htmlFor="vf-product" hint={T('scopeHint')}>
            <ProductSelect id="vf-product" value={form.productId} onChange={set('productId')} emptyLabel={T('scopeNone')} />
          </Field>
          <Field label={T('scopeCategory')} htmlFor="vf-category">
            <CategorySelect id="vf-category" value={form.categoryId} onChange={set('categoryId')} emptyLabel={T('scopeNone')} />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={T('minOrder')} htmlFor="vf-min">
          <Input id="vf-min" type="number" value={form.minSpend} onChange={text('minSpend')} placeholder="50000" />
        </Field>
        <Field label={T('quota')} htmlFor="vf-quota" hint={T('quotaHint')}>
          <Input id="vf-quota" type="number" value={form.usageLimit} onChange={text('usageLimit')} placeholder="1000" />
        </Field>
        <Field label={T('perUser')} htmlFor="vf-per">
          <Input id="vf-per" type="number" value={form.perCustomerLimit} onChange={text('perCustomerLimit')} placeholder="1" />
        </Field>
        <Field label={T('budget')} htmlFor="vf-budget" hint={T('budgetHint')}>
          <Input id="vf-budget" type="number" value={form.budgetCap} onChange={text('budgetCap')} placeholder="5000000" />
        </Field>
        <Field label={T('validFrom')} htmlFor="vf-from" hint={T('validHint')}>
          <Input id="vf-from" type="date" value={form.validFrom} onChange={text('validFrom')} />
        </Field>
        <Field label={T('validUntil')} htmlFor="vf-until">
          <Input id="vf-until" type="date" value={form.validUntil} onChange={text('validUntil')} />
        </Field>
      </div>

      {voucher && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active')(e.target.checked)} />
          {T('active')}
        </label>
      )}

      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {voucher ? (
          <Button onClick={() => void submit(form.active)} loading={busy}>
            {T('save')}
          </Button>
        ) : (
          <>
            <Button onClick={() => void submit(true)} loading={busy}>
              {T('publish')}
            </Button>
            {allowDraft && (
              <Button variant="ghost" onClick={() => void submit(false)} disabled={busy}>
                {T('saveDraft')}
              </Button>
            )}
          </>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {T('cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
