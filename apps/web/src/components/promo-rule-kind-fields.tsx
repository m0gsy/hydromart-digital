'use client';

import type { Dispatch, SetStateAction } from 'react';

import { ProductSelect } from '@/components/catalog-select';
import { Field, Input } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import type { RuleForm } from '@/lib/promo-rule-form';
import type { PromoRuleKind } from '@/lib/types';

/*
 * The kind-specific half of the promo-rule editor, shared by the HQ and depot-console pages.
 * `ns` is the dictionary namespace the page's own copy lives under ('hq' | 'dashboard'); the
 * keys are the same in both.
 */
type Ns = 'hq' | 'dashboard';
type SetForm = Dispatch<SetStateAction<RuleForm>>;

const SELECT_CLASS = 'w-full rounded-lg border border-app bg-surface px-3 py-2.5 text-sm';

export const PROMO_KINDS: PromoRuleKind[] = [
  'SPECIAL_PRICE',
  'PERCENTAGE_OFF',
  'BUY_X_GET_Y',
  'BUNDLE_GIFT',
  'ORDER_DISCOUNT',
  'SHIPPING_DISCOUNT',
];

const KIND_KEY: Record<PromoRuleKind, string> = {
  SPECIAL_PRICE: 'kindSpecialPrice',
  PERCENTAGE_OFF: 'kindPercentOff',
  BUY_X_GET_Y: 'kindBogo',
  BUNDLE_GIFT: 'kindBundleGift',
  ORDER_DISCOUNT: 'kindOrderDiscount',
  SHIPPING_DISCOUNT: 'kindShipping',
};

export function PromoKindSelect({ ns, form, setForm }: { ns: Ns; form: RuleForm; setForm: SetForm }) {
  const { t } = useT();
  return (
    <Field label={t(`${ns}.promoRules.fields.kind`)}>
      <select
        className={SELECT_CLASS}
        value={form.kind}
        onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PromoRuleKind }))}
      >
        {PROMO_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`${ns}.promoRules.fields.${KIND_KEY[kind]}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function PromoKindFields({ ns, form, setForm }: { ns: Ns; form: RuleForm; setForm: SetForm }) {
  const { t } = useT();
  const label = (key: string) => t(`${ns}.promoRules.fields.${key}`);
  const set = (k: keyof RuleForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const number = (k: keyof RuleForm, key: string, hint?: string) => (
    <Field label={label(key)} hint={hint}>
      <Input type="number" value={form[k] as string} onChange={set(k)} />
    </Field>
  );

  switch (form.kind) {
    case 'SPECIAL_PRICE':
      return number('specialPrice', 'specialPrice');
    case 'PERCENTAGE_OFF':
      return number('percentOff', 'percentOff', label('percentOffHint'));
    case 'BUY_X_GET_Y':
      return (
        <>
          {number('buyQty', 'buyQty')}
          {number('getQty', 'getQty')}
        </>
      );
    case 'BUNDLE_GIFT':
      return (
        <>
          {number('buyQty', 'buyQty')}
          {number('getQty', 'giftQty')}
          <Field label={label('giftProductId')} hint={label('giftProductHint')}>
            <ProductSelect
              value={form.giftProductId}
              onChange={(v) => setForm((f) => ({ ...f, giftProductId: v }))}
              emptyLabel={label('pickGiftProduct')}
            />
          </Field>
        </>
      );
    case 'ORDER_DISCOUNT':
      return (
        <>
          {number('minSubtotal', 'minSubtotal', label('minSubtotalHint'))}
          <Field label={label('orderMode')}>
            <select
              className={SELECT_CLASS}
              value={form.orderMode}
              onChange={(e) =>
                setForm((f) => ({ ...f, orderMode: e.target.value === 'PERCENT' ? 'PERCENT' : 'AMOUNT' }))
              }
            >
              <option value="AMOUNT">{label('orderModeAmount')}</option>
              <option value="PERCENT">{label('orderModePercent')}</option>
            </select>
          </Field>
          {form.orderMode === 'PERCENT'
            ? number('percentOff', 'percentOff', label('percentOffHint'))
            : number('discountAmount', 'discountAmount')}
        </>
      );
    default:
      return number('shippingFeeOverride', 'shippingFeeOverride');
  }
}

export function PromoFirstOrderField({ ns, form, setForm }: { ns: Ns; form: RuleForm; setForm: SetForm }) {
  const { t } = useT();
  return (
    <Field label={t(`${ns}.promoRules.fields.firstOrderOnly`)} hint={t(`${ns}.promoRules.fields.firstOrderOnlyHint`)}>
      <label className="flex items-center gap-2 py-2 text-sm">
        <input
          type="checkbox"
          checked={form.firstOrderOnly}
          onChange={(e) => setForm((f) => ({ ...f, firstOrderOnly: e.target.checked }))}
        />
        {t(`${ns}.promoRules.fields.firstOrderOnly`)}
      </label>
    </Field>
  );
}
