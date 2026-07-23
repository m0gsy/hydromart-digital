'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bank,
  Check,
  CheckCircle,
  DeviceMobile,
  Hash,
  Lightning,
  Money as MoneyIcon,
  NotePencil,
  Plus,
  QrCode,
  ShieldCheck,
  Tag,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, Chip, ErrorState, Field, Input, Money, RadioCard, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { addressToForm, pickDefaultAddress } from '@/lib/addresses';
import { formatIDR } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/payments';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  Address,
  Cart,
  LoyaltyAccount,
  MyVoucher,
  NearbyDepot,
  Order,
  PaymentMethod,
  VoucherQuote,
} from '@/lib/types';

// Advisory express-delivery surcharge shown as a pre-submit preview only. order-service
// computes the authoritative delivery fee from the routed depot at checkout.
const EXPRESS_FEE = 5000;
// The deliveryWindow value order-service/depot reads is a locale-independent ID literal
// (matches the existing scheduled-slot strings), so express keeps an ID marker too.
const EXPRESS_WINDOW = 'Antar sekarang (express)';

type SlotCapacity = 'OK' | 'LOW' | 'FULL';
// ponytail: capacity static, wire when depot slot API exists. Times are ID literals so the
// depot console reads them unchanged (same as the previous flat slot chips).
const SLOTS: { time: string; period: 'periodMorning' | 'periodNoon' | 'periodAfternoon' | 'periodEvening'; cap: SlotCapacity }[] = [
  { time: '09.00–11.00', period: 'periodMorning', cap: 'FULL' },
  { time: '11.00–13.00', period: 'periodNoon', cap: 'OK' },
  { time: '13.00–15.00', period: 'periodNoon', cap: 'OK' },
  { time: '15.00–17.00', period: 'periodAfternoon', cap: 'OK' },
  { time: '17.00–19.00', period: 'periodAfternoon', cap: 'LOW' },
];

/** The next 4 delivery dates as { key: ID-literal label, num: day-of-month }. */
function buildDates(t: (k: string) => string): { key: string; num: number }[] {
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const key = i === 0 ? t('customerFix.slot.today') : i === 1 ? t('customerFix.slot.tomorrow') : (days[d.getDay()] ?? '');
    return { key, num: d.getDate() };
  });
}

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
  // Voucher wallet — powers the min-spend progress bar (gap 13n) and the "usable now"
  // suggestions. Fail-soft: absence just hides those hints, never blocks checkout.
  const { data: myVouchers } = useAsync<MyVoucher[]>(() => api.get(endpoints.vouchers.me, true));

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
  // Preferred delivery window (gap 13b). '' = Secepatnya (ASAP) → sent as undefined.
  // deliveryWindow stays the single value the order submit reads; the express / date /
  // slot selections below are just UI state that derive into it.
  const [deliveryWindow, setDeliveryWindow] = useState('');
  const [express, setExpress] = useState(false);
  const [slotDateIdx, setSlotDateIdx] = useState(0);
  const [slotTime, setSlotTime] = useState<string | null>(null);
  const dates = buildDates(t);

  // Derive the submitted deliveryWindow from the express/date/slot selections.
  useEffect(() => {
    if (express) setDeliveryWindow(EXPRESS_WINDOW);
    else if (slotTime) setDeliveryWindow(`${dates[slotDateIdx]?.key ?? ''}, ${slotTime}`);
    else setDeliveryWindow('');
    // dates is rebuilt each render but its content is date-stable within a day; depend on idx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [express, slotTime, slotDateIdx]);
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

  async function applyVoucher(codeOverride?: string) {
    const code = (codeOverride ?? voucherCode).trim().toUpperCase();
    if (!cart || !code) return;
    if (codeOverride) setVoucherCode(code);
    setQuoting(true);
    setVoucherError(null);
    setQuote(null);
    try {
      const result = await api.post<VoucherQuote>(
        endpoints.vouchers.quote,
        { code, subtotal: cart.subtotal },
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
          deliveryWindow: deliveryWindow || undefined,
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
  // order-service computes the authoritative delivery fee + order total from the
  // routed depot at checkout — this displayedTotal is just a pre-submit preview.
  const depot = nearbyDepots?.[0] ?? null;
  const deliveryFee = depot?.deliveryFee ?? 0;
  // ponytail: express surcharge is display-only until a depot express-pricing API exists.
  const expressFee = express ? EXPRESS_FEE : 0;
  const displayedTotal = estimatedTotal + deliveryFee + expressFee;

  // 13n — when a voucher fails, surface how far the cart is from eligibility. minSpend
  // comes from the wallet voucher matching the typed code (the value already in scope).
  const failedVoucher =
    voucherError && !quote ? myVouchers?.find((v) => v.code === voucherCode.trim().toUpperCase()) ?? null : null;
  const voucherShortfall =
    failedVoucher && failedVoucher.minSpend > cart.subtotal ? failedVoucher.minSpend - cart.subtotal : 0;
  const voucherProgressPct = failedVoucher
    ? Math.min(100, Math.round((cart.subtotal / failedVoucher.minSpend) * 100))
    : 0;
  // Other wallet vouchers that already clear the cart's subtotal — offer them as one-tap swaps.
  const usableVouchers = voucherError
    ? (myVouchers ?? []).filter(
        (v) => v.status === 'AVAILABLE' && v.code !== voucherCode.trim().toUpperCase() && v.minSpend <= cart.subtotal,
      )
    : [];

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

          {/* Delivery window (gap 13b) — express-now + date row + slots w/ capacity, advisory to depot */}
          <Card className="flex flex-col gap-3 rounded-[22px] p-[22px]">
            <h2 className="text-base font-extrabold">{t('order.checkout.deliveryWindow')}</h2>

            {/* Express-now */}
            <button
              type="button"
              onClick={() => {
                setExpress((v) => !v);
                setSlotTime(null);
              }}
              aria-pressed={express}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-shadow ${
                express ? 'bg-gradient-to-br from-brand-800 to-brand-600 text-on-brand shadow-lift' : 'bg-gradient-to-br from-brand-800 to-brand-600 text-on-brand opacity-90 hover:opacity-100'
              }`}
            >
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Lightning size={24} weight="fill" />
              </span>
              <span className="flex-1">
                <span className="block text-[14.5px] font-extrabold">{t('customerFix.slot.expressNow')}</span>
                <span className="block text-xs text-white/85">{t('customerFix.slot.expressEta')}</span>
              </span>
              <span className="flex items-center gap-2 text-[13px] font-extrabold">
                {t('customerFix.slot.expressFee', { amount: formatIDR(EXPRESS_FEE) })}
                {express && <Check size={16} weight="bold" />}
              </span>
            </button>

            <div className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">
              {t('customerFix.slot.orSchedule')}
            </div>

            {/* Date row */}
            <div className="flex gap-2 overflow-x-auto">
              {dates.map((d, i) => {
                const on = !express && slotDateIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSlotDateIdx(i);
                      setExpress(false);
                    }}
                    aria-pressed={on}
                    className={`min-w-[66px] flex-none rounded-xl px-1 py-2 text-center transition-colors ${
                      on ? 'bg-[color:var(--text)] text-[color:var(--surface)]' : 'border border-app bg-[color:var(--surface)]'
                    }`}
                  >
                    <span className={`block text-[11px] font-semibold ${on ? 'text-[color:var(--surface)]/70' : 'text-muted'}`}>
                      {d.key}
                    </span>
                    <span className="mt-0.5 block text-[15px] font-extrabold tabular-nums">{d.num}</span>
                  </button>
                );
              })}
            </div>

            {/* Slots + capacity */}
            <div className="flex flex-col gap-2.5">
              {SLOTS.map((s) => {
                const on = !express && slotTime === s.time;
                const full = s.cap === 'FULL';
                return (
                  <button
                    key={s.time}
                    type="button"
                    disabled={full}
                    onClick={() => {
                      setSlotTime(s.time);
                      setExpress(false);
                    }}
                    aria-pressed={on}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed ${
                      on
                        ? 'border-[1.5px] border-brand-600 bg-brand-50'
                        : full
                          ? 'border-app bg-[color:var(--surface)] opacity-55'
                          : 'border-app bg-[color:var(--surface)] hover:border-brand-300'
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-bold">{s.time}</span>
                      <span className={`block text-[11.5px] ${on ? 'font-semibold text-brand-800' : 'text-muted'}`}>
                        {t(`customerFix.slot.${s.period}`)}
                        {on && ` · ${t('customerFix.slot.selected')}`}
                      </span>
                    </span>
                    {full ? (
                      <span className="text-[11.5px] font-extrabold text-[color:var(--danger)]">{t('customerFix.slot.capFull')}</span>
                    ) : s.cap === 'LOW' ? (
                      <span className="text-[11.5px] font-extrabold text-[color:var(--warning,#b97d10)]">{t('customerFix.slot.capLow')}</span>
                    ) : on ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-on-brand">
                        <Check size={12} weight="bold" />
                      </span>
                    ) : (
                      <span className="h-5 w-5 rounded-full border-[1.5px] border-app" />
                    )}
                  </button>
                );
              })}
            </div>
            {express && <p className="text-xs text-muted">{t('customerFix.slot.feeNote')}</p>}
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
                onClick={() => applyVoucher()}
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
              <p className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--danger)]" role="alert">
                <WarningCircle size={16} weight="fill" className="flex-shrink-0" />
                {voucherError}
              </p>
            )}
            {voucherShortfall > 0 && (
              <div className="flex flex-col gap-2 rounded-[14px] bg-[color:var(--surface-muted)] p-3.5">
                <p className="text-[13px] font-bold">
                  {t('customerFix.voucher.shortfall', { amount: formatIDR(voucherShortfall) })}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${voucherProgressPct}%` }} />
                </div>
                <Link
                  href="/products"
                  className="flex items-center gap-1.5 self-start text-[13px] font-extrabold text-brand-800"
                >
                  <Plus size={14} weight="bold" />
                  {t('customerFix.voucher.addProduct')}
                </Link>
              </div>
            )}
            {usableVouchers.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold text-muted">{t('customerFix.voucher.usableNow')}</p>
                {usableVouchers.map((v) => (
                  <div
                    key={v.code}
                    className="flex items-center gap-2.5 rounded-[14px] border border-app p-3"
                  >
                    <Tag size={16} weight="fill" className="flex-shrink-0 text-brand-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[13px] font-bold tracking-[0.06em]">{v.code}</div>
                      <div className="text-xs text-muted">
                        {t('customerFix.voucher.min', { min: formatIDR(v.minSpend) })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setVoucherCode(v.code);
                        setVoucherError(null);
                        void applyVoucher(v.code);
                      }}
                      className="h-9 flex-shrink-0 rounded-full px-4 text-[13px] font-extrabold"
                    >
                      {t('customerFix.voucher.use')}
                    </Button>
                  </div>
                ))}
              </div>
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
