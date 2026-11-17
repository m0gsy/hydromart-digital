import type { DiscountType, Voucher, VoucherPayload } from './types';
import { dayEndWib, dayStartWib, todayWib } from './wib';

/**
 * The voucher editor's form model, shared by /hq/forms/voucher, /hq/vouchers and
 * /dashboard/vouchers.
 *
 * There used to be two forms for the one record, each missing what the other had: head office's
 * could set a budget but not a description and could not edit at all; the depot console's could
 * edit but had no budget and sent its dates as 07:00 WIB. Neither could say who may spend a code
 * (`audience`) or where (`depotId`), though the server has both — so every voucher was a public
 * network code, and "give this customer a voucher" handed out a code anybody could type.
 */

export type VoucherAudience = 'PUBLIC' | 'GRANTED';

export interface VoucherForm {
  code: string;
  description: string;
  /** PUBLIC: anybody with the code. GRANTED: only the customers it is given to. */
  audience: VoucherAudience;
  discountType: DiscountType;
  value: string;
  maxDiscount: string;
  productId: string;
  categoryId: string;
  minSpend: string;
  usageLimit: string;
  perCustomerLimit: string;
  budgetCap: string;
  /** WIB calendar days, `YYYY-MM-DD`; '' = open. */
  validFrom: string;
  validUntil: string;
  /** '' = every depot, which only head office may choose. */
  depotId: string;
  active: boolean;
}

export const emptyVoucherForm = (depotId = ''): VoucherForm => ({
  code: '',
  description: '',
  audience: 'PUBLIC',
  discountType: 'PERCENTAGE',
  value: '',
  maxDiscount: '',
  productId: '',
  categoryId: '',
  minSpend: '',
  usageLimit: '',
  perCustomerLimit: '1',
  budgetCap: '',
  validFrom: '',
  validUntil: '',
  depotId,
  active: true,
});

export function voucherFormFrom(v: Voucher): VoucherForm {
  // The WIB day of the stored instant. `slice(0, 10)` read head office's 00:00 WIB as the day
  // before, and every save moved the start another day back.
  const day = (iso: string | null) => (iso ? todayWib(new Date(iso)) : '');
  const num = (n: number | null | undefined) => (n == null ? '' : String(n));
  return {
    code: v.code,
    description: v.description ?? '',
    audience: v.audience === 'GRANTED' ? 'GRANTED' : 'PUBLIC',
    discountType: v.discountType,
    value: String(v.value),
    maxDiscount: num(v.maxDiscount),
    productId: v.productId ?? '',
    categoryId: v.categoryId ?? '',
    minSpend: v.minSpend ? String(v.minSpend) : '',
    usageLimit: num(v.usageLimit),
    perCustomerLimit: String(v.perCustomerLimit),
    budgetCap: num(v.budgetCap),
    validFrom: day(v.validFrom),
    validUntil: day(v.validUntil),
    depotId: v.depotId ?? '',
    active: v.active,
  };
}

/**
 * The first thing wrong with the form, as a key under `hq.forms.voucher`; null = sendable. The
 * server refuses all of these too — saying it here keeps the cashier-facing sentence ours.
 */
export function voucherFormProblem(
  f: VoucherForm,
  mode: 'create' | 'edit',
  depotRequired: boolean,
): string | null {
  if (mode === 'create') {
    if (!f.code.trim()) return 'needCode';
    // promo-service refuses anything shorter: a short code is one anybody can guess.
    if (f.code.trim().length < 6) return 'codeTooShort';
  }
  if (f.discountType !== 'FREE_SHIPPING') {
    const value = Number(f.value);
    if (!f.value.trim() || !(value > 0)) return 'needValue';
    if (f.discountType === 'PERCENTAGE' && value > 100) return 'percentTooHigh';
    if (f.productId && f.categoryId) return 'scopeBoth';
  }
  if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) return 'endBeforeStart';
  if (depotRequired && !f.depotId) return 'needDepot';
  return null;
}

/** `code` travels on create only — the server never patches a code. */
export function voucherFormToPayload(f: VoucherForm, mode: 'create' | 'edit'): VoucherPayload {
  const int = (s: string) => (s.trim() === '' ? undefined : Number(s));
  // A free-shipping voucher has no goods to scope and no value of its own.
  const goods = f.discountType !== 'FREE_SHIPPING';
  const payload: VoucherPayload = {
    description: f.description.trim() || null,
    audience: f.audience,
    discountType: f.discountType,
    value: goods ? Number(f.value) : 0,
    minSpend: int(f.minSpend) ?? 0,
    maxDiscount: f.discountType === 'PERCENTAGE' ? (int(f.maxDiscount) ?? null) : null,
    // Whole WIB days: "until the 30th" runs to the last millisecond of the 30th in Jakarta.
    validFrom: f.validFrom ? dayStartWib(f.validFrom) : null,
    validUntil: f.validUntil ? dayEndWib(f.validUntil) : null,
    usageLimit: int(f.usageLimit) ?? null,
    perCustomerLimit: int(f.perCustomerLimit) ?? 1,
    budgetCap: int(f.budgetCap) ?? null,
    productId: goods ? f.productId || null : null,
    categoryId: goods ? f.categoryId || null : null,
    depotId: f.depotId || null,
    active: f.active,
  };
  if (mode === 'create') payload.code = f.code.trim().toUpperCase();
  return payload;
}

/** Where a voucher stands today, for the lists: switched off, not started, ended, or live. */
export function voucherState(
  v: Pick<Voucher, 'active' | 'validFrom' | 'validUntil'>,
  now: Date = new Date(),
): 'inactive' | 'upcoming' | 'expired' | 'active' {
  if (!v.active) return 'inactive';
  if (v.validFrom && new Date(v.validFrom) > now) return 'upcoming';
  if (v.validUntil && new Date(v.validUntil) < now) return 'expired';
  return 'active';
}
