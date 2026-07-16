'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bank,
  Check,
  CheckCircle,
  DeviceMobile,
  Hash,
  Money as MoneyIcon,
  NotePencil,
  QrCode,
  ShieldCheck,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, Chip, ErrorState, Field, Input, Money, RadioCard, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { addressToForm, pickDefaultAddress } from '@/lib/addresses';
import { PAYMENT_METHODS } from '@/lib/payments';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  Address,
  Cart,
  LoyaltyAccount,
  NearbyDepot,
  Order,
  PaymentMethod,
  VoucherQuote,
} from '@/lib/types';

const PAY_ICONS: Record<PaymentMethod, typeof Bank> = {
  CASH: MoneyIcon,
  TRANSFER: Bank,
  QRIS: QrCode,
  EWALLET: DeviceMobile,
  VA: Hash,
};

function CheckoutInner() {
  const { t } = useT();
  const router = useRouter();
  const { customer } = useAuth();
  const { data: cart, error, loading, reload } = useAsync<Cart>(() =>
    api.get(endpoints.cart.view, true),
  );
  // Non-blocking: the membership discount is a bonus preview. If loyalty is down
  // the customer still checks out (order-service applies the tier discount itself,
  // fail-open). rate 0 on any error.
  const { data: loyalty } = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  // Saved address book. Fail-soft: if this can't load, the customer just types a fresh
  // address (as before) — never blocks checkout, so the load error is intentionally ignored.
  const { data: savedAddresses } = useAsync<Address[]>(() =>
    api.get(endpoints.addresses.list, true),
  );

  const [voucherCode, setVoucherCode] = useState('');
  const [quote, setQuote] = useState<VoucherQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  const [form, setForm] = useState({
    recipientName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    addressLine: '',
    city: '',
    province: '',
    postalCode: '',
    notes: '',
  });
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState(false);

  // `null` = a fresh manually-typed address (no saved coordinates). Selecting a saved
  // address stashes its lat/lng, which lets order-service route the order to a depot
  // (per-depot pricing, delivery fee, stock reservation) — a manual address has none.
  const [selection, setSelection] = useState<'new' | string | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  // Advisory delivery-fee preview: when the selected address carries coords, look up the
  // nearest depot to show an estimated ongkir. Fail-soft — errors are ignored and no fee is
  // added; this is display-only and never sent to the API or used in placeOrder.
  const { data: nearbyDepots } = useAsync<NearbyDepot[]>(
    () =>
      coords.latitude != null && coords.longitude != null
        ? api.get(
            endpoints.depots.nearby({ lat: coords.latitude, lng: coords.longitude, limit: 1 }),
            true,
          )
        : Promise.resolve([]),
    [coords.latitude, coords.longitude],
  );

  // Preselect the primary saved address (else the first) the first time the book loads.
  useEffect(() => {
    if (selection !== null || !savedAddresses || savedAddresses.length === 0) return;
    const preferred = pickDefaultAddress(savedAddresses);
    if (preferred) {
      setSelection(preferred.id);
      setForm((f) => ({ ...f, ...addressToForm(preferred) }));
      setCoords({ latitude: preferred.latitude, longitude: preferred.longitude });
    }
  }, [savedAddresses, selection]);

  function chooseSaved(address: Address) {
    setSelection(address.id);
    setForm((f) => ({ ...f, ...addressToForm(address) }));
    setCoords({ latitude: address.latitude, longitude: address.longitude });
  }

  function chooseNew() {
    setSelection('new');
    setCoords({ latitude: null, longitude: null });
    setForm({
      recipientName: customer?.fullName ?? '',
      phone: customer?.phone ?? '',
      addressLine: '',
      city: '',
      province: '',
      postalCode: '',
      notes: '',
    });
  }

  // Editing an address field detaches from the saved coordinates (they no longer match).
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k !== 'notes') setCoords({ latitude: null, longitude: null });
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function applyVoucher() {
    if (!cart || !voucherCode.trim()) return;
    setQuoting(true);
    setVoucherError(null);
    setQuote(null);
    try {
      const result = await api.post<VoucherQuote>(
        endpoints.vouchers.quote,
        { code: voucherCode.trim(), subtotal: cart.subtotal },
        true,
      );
      setQuote(result);
    } catch (err) {
      setVoucherError(
        err instanceof ApiError ? err.message : t('order.checkout.voucherInvalid'),
      );
    } finally {
      setQuoting(false);
    }
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await api.post<Order>(
        endpoints.orders.checkout,
        {
          deliveryAddress: {
            recipientName: form.recipientName,
            phone: form.phone,
            addressLine: form.addressLine,
            city: form.city,
            province: form.province,
            postalCode: form.postalCode || undefined,
            latitude: coords.latitude ?? undefined,
            longitude: coords.longitude ?? undefined,
            notes: form.notes || undefined,
          },
          // order-service re-validates the voucher (fail-closed) and applies the
          // membership discount itself; sending the raw code is enough.
          voucherCode: voucherCode.trim() || undefined,
        },
        true,
      );
      // Save a fresh address to the book (non-blocking) so it's reusable next time.
      if (saveToBook && !savedAddresses?.some((a) => a.id === selection)) {
        try {
          await api.post(
            endpoints.addresses.create,
            {
              label: saveLabel.trim() || 'Alamat',
              recipientName: form.recipientName,
              phone: form.phone,
              addressLine: form.addressLine,
              city: form.city,
              province: form.province,
              postalCode: form.postalCode || undefined,
            },
            true,
          );
        } catch {
          /* the order is placed; a failed address save must not block the flow */
        }
      }
      // Initiate payment for the placed order; failure here still leaves a valid
      // order the customer can pay from the order page, so we don't hard-block.
      try {
        await api.post(
          endpoints.payments.initiate,
          { orderId: order.id, method, amount: order.total },
          true,
        );
      } catch {
        /* order exists; payment can be retried on the order page */
      }
      // placed=1 triggers the one-time success banner on the order page (spec 5b).
      router.replace(`/orders/${order.id}?placed=1`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('order.checkout.placeOrderError'));
      setSubmitting(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!cart || cart.items.length === 0) {
    return <ErrorState message={t('order.checkout.emptyCart')} />;
  }

  const isSavedSelection = savedAddresses?.some((a) => a.id === selection) ?? false;

  // Preview only — order-service computes the authoritative discount at checkout.
  const membershipRate = loyalty?.discountRate ?? 0;
  const membershipDiscount = Math.floor(cart.subtotal * membershipRate);
  const voucherDiscount = quote?.discount ?? 0;
  const totalDiscount = Math.min(cart.subtotal, membershipDiscount + voucherDiscount);
  const estimatedTotal = cart.subtotal - totalDiscount;

  // Advisory only: display-only ongkir estimate, never part of the API payload.
  const depot = nearbyDepots?.[0] ?? null;
  const deliveryFee = depot?.deliveryFee ?? 0;
  const displayedTotal = estimatedTotal + deliveryFee;

  return (
    <form onSubmit={placeOrder} className="flex flex-col">
      {/* Progress stepper — centered in-page row */}
      <div className="mb-7 flex items-center justify-center gap-1.5 text-[11px] font-bold sm:gap-2.5 sm:text-[13px]">
        <span className="flex items-center gap-1.5 text-brand-800 sm:gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand">
            <Check size={12} weight="bold" />
          </span>
          {t('order.checkout.stepCart')}
        </span>
        <span className="h-[1.5px] w-4 flex-shrink bg-brand-600 sm:w-[34px]" />
        <span className="flex items-center gap-1.5 text-brand-800 sm:gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--text)] text-[11.5px] text-[color:var(--surface)]">
            2
          </span>
          {t('order.checkout.stepCheckout')}
        </span>
        <span className="h-[1.5px] w-4 flex-shrink bg-[color:var(--border)] sm:w-[34px]" />
        <span className="flex items-center gap-1.5 text-muted sm:gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--surface-soft)] text-[11.5px] text-muted">
            3
          </span>
          {t('order.checkout.stepDone')}
        </span>
      </div>

      <h1 className="mb-5 text-[30px] font-extrabold tracking-[-0.03em]">
        {t('order.checkout.title')}
      </h1>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* LEFT column */}
        <div className="flex flex-col gap-4">
          {/* Deliver to */}
          <Card className="flex flex-col gap-3 rounded-[22px] p-[22px]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold">{t('order.checkout.deliveryAddress')}</h2>
              <button
                type="button"
                onClick={chooseNew}
                className="text-[13px] font-bold text-brand-700 hover:text-brand-800"
              >
                {t('order.checkout.newAddress')}
              </button>
            </div>

            {savedAddresses && savedAddresses.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {savedAddresses.map((a) => {
                  const on = selection === a.id;
                  return (
                    <RadioCard key={a.id} selected={on} onSelect={() => chooseSaved(a)}>
                      <span
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                          on ? 'bg-brand-600 text-on-brand' : 'border-2 border-app'
                        }`}
                      >
                        {on && <Check size={11} weight="bold" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-extrabold">
                          {a.label}
                          {a.isPrimary && <Chip tone="tint">{t('order.checkout.primary')}</Chip>}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-muted">
                          {a.recipientName} · {a.phone}
                        </span>
                        <span className="block text-[13px] text-muted">
                          {a.addressLine}, {a.city}
                        </span>
                      </span>
                    </RadioCard>
                  );
                })}
              </div>
            )}

            {/* Manual entry — the "new address" flow (hidden when a saved address is picked) */}
            {!isSavedSelection && (
              <div className="flex flex-col gap-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('order.checkout.recipientName')} htmlFor="recipientName">
                    <Input id="recipientName" required value={form.recipientName} onChange={set('recipientName')} />
                  </Field>
                  <Field label={t('order.checkout.phone')} htmlFor="phone">
                    <Input id="phone" required value={form.phone} onChange={set('phone')} inputMode="tel" />
                  </Field>
                </div>
                <Field label={t('order.checkout.address')} htmlFor="addressLine">
                  <Input id="addressLine" required value={form.addressLine} onChange={set('addressLine')} placeholder={t('order.checkout.addressPlaceholder')} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t('order.checkout.city')} htmlFor="city">
                    <Input id="city" required value={form.city} onChange={set('city')} />
                  </Field>
                  <Field label={t('order.checkout.province')} htmlFor="province">
                    <Input id="province" required value={form.province} onChange={set('province')} />
                  </Field>
                  <Field label={t('order.checkout.postalCode')} htmlFor="postalCode" hint={t('order.checkout.optional')}>
                    <Input id="postalCode" value={form.postalCode} onChange={set('postalCode')} inputMode="numeric" />
                  </Field>
                </div>
                <div className="flex flex-col gap-2 border-t border-app pt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={saveToBook}
                      onChange={(e) => setSaveToBook(e.target.checked)}
                      className="accent-brand-600"
                    />
                    {t('order.checkout.saveAddress')}
                  </label>
                  {saveToBook && (
                    <Field label={t('order.checkout.addressLabel')} htmlFor="saveLabel" hint={t('order.checkout.addressLabelHint')}>
                      <Input
                        id="saveLabel"
                        value={saveLabel}
                        onChange={(e) => setSaveLabel(e.target.value)}
                        placeholder={t('order.checkout.addressLabelPlaceholder')}
                        maxLength={50}
                      />
                    </Field>
                  )}
                </div>
              </div>
            )}

            {/* Driver note row */}
            <div className="flex items-center gap-2.5 rounded-[14px] bg-[color:var(--surface-muted)] px-3.5 py-3 text-[12.5px]">
              <NotePencil size={16} weight="fill" className="flex-shrink-0 text-brand-600" />
              {editingNote ? (
                <input
                  autoFocus
                  value={form.notes}
                  onChange={set('notes')}
                  onBlur={() => setEditingNote(false)}
                  placeholder={t('order.checkout.courierNotesPlaceholder')}
                  aria-label={t('order.checkout.courierNotes')}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--text-muted)]"
                />
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {t('order.checkout.courierNotes')}:{' '}
                    {form.notes || t('order.checkout.courierNotesPlaceholder')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingNote(true)}
                    className="flex-shrink-0 font-bold text-brand-700 hover:text-brand-800"
                  >
                    {t('account.profileCard.edit')}
                  </button>
                </>
              )}
            </div>
          </Card>

          {/* Payment method */}
          <Card className="flex flex-col gap-3 rounded-[22px] p-[22px]">
            <h2 className="text-base font-extrabold">{t('order.checkout.paymentMethod')}</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {PAYMENT_METHODS.map((m) => {
                const Icon = PAY_ICONS[m.value];
                const on = method === m.value;
                return (
                  <RadioCard key={m.value} selected={on} onSelect={() => setMethod(m.value)} className="items-center">
                    <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px] bg-brand-50">
                      <Icon size={18} weight="fill" className="text-brand-600" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-extrabold">{m.label}</span>
                      <span className="block text-xs text-muted">{m.hint}</span>
                    </span>
                  </RadioCard>
                );
              })}
            </div>
          </Card>

          {/* Voucher */}
          <Card className="flex flex-col gap-3 rounded-[22px] p-[22px]">
            <h2 className="text-base font-extrabold">{t('order.checkout.voucher')}</h2>
            <div className="flex items-center gap-2.5">
              <Input
                aria-label={t('order.checkout.voucherCode')}
                value={voucherCode}
                onChange={(e) => {
                  setVoucherCode(e.target.value.toUpperCase());
                  setQuote(null);
                  setVoucherError(null);
                }}
                placeholder={t('order.checkout.voucherPlaceholder')}
                autoCapitalize="characters"
                className="h-12 flex-1 rounded-full border-brand-600 px-[18px] font-mono font-bold tracking-[0.08em]"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={applyVoucher}
                loading={quoting}
                disabled={!voucherCode.trim()}
                className="h-12 rounded-full border-[1.5px] border-[color:var(--text)] px-[22px] font-extrabold hover:bg-[color:var(--text)] hover:text-[color:var(--surface)]"
              >
                {t('order.checkout.apply')}
              </Button>
            </div>
            {quote && (
              <p
                className="flex items-center gap-1.5 text-sm font-bold text-[color:var(--success)]"
                role="status"
              >
                <CheckCircle size={16} weight="fill" />
                {t('order.checkout.voucherApplied', { code: quote.code })}{' '}
                <Money amount={quote.discount} />
              </p>
            )}
            {voucherError && (
              <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
                {voucherError}
              </p>
            )}
          </Card>
        </div>

        {/* RIGHT summary */}
        <Card className="flex flex-col gap-3.5 rounded-[22px] p-6 lg:sticky lg:top-20">
          <h2 className="text-[17px] font-extrabold">{t('order.checkout.orderSummary')}</h2>

          {cart.items.map((l) => (
            <div key={l.productId} className="flex items-center gap-3">
              <div className="h-11 w-11 flex-shrink-0 rounded-[10px] bg-[color:var(--surface-muted)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">{l.productName}</div>
                <div className="text-xs text-muted">×{l.quantity}</div>
              </div>
              <Money amount={l.lineTotal} className="text-[13px] font-bold" />
            </div>
          ))}

          <div className="flex flex-col gap-2.5 border-t border-app pt-3.5 text-[13.5px]">
            <div className="flex justify-between">
              <span className="text-muted">{t('order.checkout.subtotal')}</span>
              <Money amount={cart.subtotal} className="font-bold" />
            </div>
            {membershipDiscount > 0 && (
              <div className="flex justify-between text-[color:var(--success)]">
                <span>{t('order.checkout.memberDiscount', { pct: Math.round(membershipRate * 100) })}</span>
                <span className="font-bold">
                  −<Money amount={membershipDiscount} />
                </span>
              </div>
            )}
            {voucherDiscount > 0 && (
              <div className="flex justify-between text-[color:var(--success)]">
                <span>{t('order.checkout.voucherLabel', { code: quote?.code ?? '' })}</span>
                <span className="font-bold">
                  −<Money amount={voucherDiscount} />
                </span>
              </div>
            )}
            {depot ? (
              <div className="flex justify-between">
                <span className="text-muted">{t('order.checkout.deliveryEst', { name: depot.name })}</span>
                <Money amount={deliveryFee} className="font-bold" />
              </div>
            ) : (
              <p className="text-xs text-muted">{t('order.checkout.deliveryNote')}</p>
            )}
          </div>

          <div className="flex justify-between border-t border-app pt-3.5 text-[17px] font-extrabold">
            <span>{t('order.checkout.total')}</span>
            <Money amount={displayedTotal} />
          </div>

          {submitError && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {submitError}
            </p>
          )}

          <Button type="submit" loading={submitting} className="h-[54px] rounded-full text-[15px] font-extrabold">
            {t('order.checkout.placeOrder')} <Money amount={displayedTotal} />
          </Button>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck size={15} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-600" />
            {t('order.checkout.priceVerified')}
          </p>
        </Card>
      </div>
    </form>
  );
}

export default function CheckoutPage() {
  return (
    <RequireAuth>
      <CheckoutInner />
    </RequireAuth>
  );
}
