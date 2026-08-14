'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bank,
  CaretUp,
  Check,
  Clock,
  CheckCircle,
  DeviceMobile,
  Hash,
  Lightning,
  MapPin,
  Money as MoneyIcon,
  NotePencil,
  Plus,
  QrCode,
  ShieldCheck,
  Storefront,
  Tag,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';

import { Sheet } from '@/components/overlay';
import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Input,
  ListRow,
  LoadError,
  Money,
  RadioCard,
  Skeleton,
  StickyActionBar,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { addressToForm, pickDefaultAddress } from '@/lib/addresses';
import { resolveDeliveryDepot } from '@/lib/depots';
import { depotOpenState } from '@/lib/opening-hours';
import { formatIDR } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/payments';
import { haptic } from '@/lib/platform';
import { shippingFeeFor } from '@/lib/pricing';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  Address,
  Cart,
  DeliveryOptions,
  Depot,
  LoyaltyAccount,
  MyVoucher,
  NearbyDepot,
  Order,
  Page,
  PaymentMethod,
  VoucherQuote,
} from '@/lib/types';

// The deliveryWindow value order-service/depot reads is a locale-independent ID literal
// (matches the scheduled-slot strings), so express keeps an ID marker too.
const EXPRESS_WINDOW = 'Antar sekarang (express)';

/**
 * What this screen falls back to while the depot's own delivery settings are in flight, or
 * if that read fails. Express is off in the fallback on purpose: offering a paid upgrade at
 * a price this screen guessed is exactly the bug being fixed — the old constants showed
 * Rp5.000 that no order ever charged.
 */
const NO_OPTIONS: DeliveryOptions = {
  slots: [],
  expressEnabled: false,
  expressFee: 0,
  expressEtaMinMinutes: 0,
  expressEtaMaxMinutes: 0,
};

/** Which part of the day a `HH.MM-HH.MM` window starts in, for the line under it. */
function slotPeriod(slot: string): 'periodMorning' | 'periodNoon' | 'periodAfternoon' | 'periodEvening' {
  const hour = Number(slot.slice(0, 2));
  if (hour < 11) return 'periodMorning';
  if (hour < 15) return 'periodNoon';
  if (hour < 18) return 'periodAfternoon';
  return 'periodEvening';
}

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

type SheetKey = 'address' | 'depot' | 'window' | 'payment' | 'voucher';

/** A manually typed address is unusable to a courier without these. */
const MANDATORY = ['recipientName', 'phone', 'addressLine', 'city', 'province'] as const;

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
  // Saved address book. Fail-soft: if this can't load, the customer just types a fresh
  // address (as before) — never blocks checkout, so the load error is intentionally ignored.
  const { data: savedAddresses } = useAsync<Address[]>(() =>
    api.get(endpoints.addresses.list, true),
  );
  // Voucher wallet — powers the min-spend progress bar (gap 13n) and the "usable now"
  // suggestions. Fail-soft: absence just hides those hints, never blocks checkout.
  const { data: myVouchers } = useAsync<MyVoucher[]>(() => api.get(endpoints.vouchers.me, true));
  // Reseller ("agen") pricing status. Fail-soft: 404 (not a reseller) or any error just
  // leaves data null — useAsync already swallows the rejection into its ignored `error`.
  const { data: reseller } = useAsync<{
    active: boolean;
    discountPct: number;
    flatGallonPriceIdr: number;
  }>(() => api.get(endpoints.resellers.me, true));
  // A flat per-galon agen price counts as reseller pricing too — without it the badge and
  // the voucher lock disagree with what the server actually charges.
  const isReseller =
    !!reseller?.active && (reseller.discountPct > 0 || reseller.flatGallonPriceIdr > 0);

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
  /** Idempotency key for the current purchase attempt; cleared once an order is placed. */
  const attemptKey = useRef('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [sheet, setSheet] = useState<SheetKey | null>(null);
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

  // No map pin on this address → order-service cannot route it to a depot, and it now
  // refuses to place an unrouted order (one nobody could see or fulfil). So the customer
  // picks the fulfilling depot here, and that choice goes with the checkout payload.
  const needsDepotPick = coords.latitude == null || coords.longitude == null;
  const [pickedDepotId, setPickedDepotId] = useState<string | null>(null);
  const { data: depotChoices, loading: depotChoicesLoading } = useAsync<Page<Depot> | null>(
    () => (needsDepotPick ? api.get(endpoints.depots.browse({ limit: 100 })) : Promise.resolve(null)),
    [needsDepotPick],
  );

  // A pin arriving (saved address chosen) makes the manual choice meaningless — drop it.
  useEffect(() => {
    if (!needsDepotPick) setPickedDepotId(null);
  }, [needsDepotPick]);

  // The depot that will fulfil this order, however it was determined. Everything the
  // summary quotes — ongkir, membership rate — is that depot's, so it is resolved once
  // here rather than per line.
  const depot = resolveDeliveryDepot(needsDepotPick, pickedDepotId, depotChoices?.items, nearbyDepots);

  // Delivery windows and express pricing belong to the depot, not to this screen. Read for
  // the depot that will actually fulfil the order, so the surcharge shown is the one
  // order-service will charge — it used to be a constant here and nothing at all there.
  const { data: options, error: optionsError, reload: reloadOptions } = useAsync<DeliveryOptions>(
    () => api.get(endpoints.orders.deliveryOptions(depot?.id ?? null), true),
    [depot?.id],
  );
  const delivery = options ?? NO_OPTIONS;

  // Buka / istirahat / tutup for the fulfilling depot, from the hours the public depot
  // projection already carries. Only explains the missing express option — the server is
  // the one that actually withdraws it.
  const depotState = depotOpenState(depot?.operatingHours, depot?.holidays);

  // Ongkir estimate, charged per galon exactly as order.service.ts does it. Declared up here
  // because the voucher quote below needs it too: a FREE_SHIPPING voucher is priced against
  // the shipping fee, and quoting it without one made promo-service compute the waiver against
  // 0 — the screen showed "diskon Rp0" for a voucher the order then honoured in full.
  const shippingFeeEstimate = shippingFeeFor(depot?.deliveryFee ?? 0, cart?.items ?? []);

  // A depot that stops offering express while this screen is open must not leave a
  // selection that checkout would now reject.
  useEffect(() => {
    if (!delivery.expressEnabled) setExpress(false);
  }, [delivery.expressEnabled]);

  // Non-blocking: the membership discount is a bonus preview. If loyalty is down
  // the customer still checks out (order-service applies the tier discount itself,
  // fail-open). rate 0 on any error. Scoped to the fulfilling depot because both the
  // tier thresholds and the rate are per-depot settings — quoting the global rate here
  // would preview a discount the depot never gives.
  const { data: loyalty } = useAsync<LoyaltyAccount>(
    () => api.get(endpoints.loyalty.me(depot?.id ?? null), true),
    [depot?.id],
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
        { code, subtotal: cart.subtotal, shippingFee: shippingFeeEstimate },
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
    // The address fields live in a sheet now, which renders outside the form element, so
    // `required` cannot see them — and a browser that could would aim its tooltip at a field
    // nobody can see. The check is explicit instead, and it opens the sheet it is about.
    if (!isSavedSelection && MANDATORY.some((k) => !form[k].trim())) {
      setSheet('address');
      setSubmitError(t('order.checkout.addressRequired'));
      return;
    }
    setSubmitting(true);
    haptic(); // the one irreversible tap on this screen

    setSubmitError(null);
    // B-13: one key for this whole attempt at buying this cart, deliberately kept across
    // failed submits. If the request timed out on an order the server had already placed,
    // pressing Pesan again returns that order instead of buying the water twice. It is
    // only rotated after a placed order, when the next submit really is a new purchase.
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
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
          // Only meaningful without coordinates; with a pin, order-service routes itself.
          depotId: needsDepotPick ? pickedDepotId ?? undefined : undefined,
          // order-service re-validates the voucher (fail-closed) and applies the
          // membership discount itself; sending the raw code is enough.
          // Gate on isReseller: never send voucher code for resellers (flat pricing, no stacking).
          voucherCode: isReseller ? undefined : voucherCode.trim() || undefined,
          deliveryWindow: deliveryWindow || undefined,
          // The intent, not the price: order-service reads the surcharge from the depot's
          // own settings. Nothing this screen believes about money is sent.
          express: express || undefined,
        },
        true,
        { 'Idempotency-Key': attemptKey.current },
      );
      attemptKey.current = '';
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
      router.replace(`/orders/detail?id=${order.id}&placed=1`);
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
  // A reseller gets NEITHER membership nor voucher — order-service replaces both with the
  // agen price. Previewing a membership discount the server will not apply put a number on
  // screen that the bill then contradicted, which is the defect the express fee already
  // taught us once. The agen discount itself cannot be previewed honestly here: the flat
  // price applies per galon line and excludes wholesale-band lines, and the cart carries
  // neither flag. So the summary shows list price and says the agen price lands at checkout.
  // `Math.round`, not `Math.floor`: order-service prices this through `money()`, which rounds
  // to whole rupiah. Flooring here showed Rp4.999 for a discount the order stored as Rp5.000 —
  // a preview that contradicts the bill, which is the defect the express fee taught us once.
  // Pinned by "membership discount rounds exactly like the server" in test/pricing.test.ts.
  const membershipDiscount = isReseller ? 0 : Math.round(cart.subtotal * membershipRate);

  // Advisory only: display-only ongkir estimate, never part of the API payload.
  // order-service computes the authoritative delivery fee + order total from the
  // routed depot at checkout — this displayedTotal is just a pre-submit preview.
  // Charged per galon, exactly as order.service.ts does it — a flat per-order preview
  // under-quoted every cart with more than one galon. `depot` is resolved further up,
  // because the membership-rate lookup needs it too.
  const deliveryFee = shippingFeeEstimate;
  // ponytail: express surcharge is display-only until a depot express-pricing API exists.
  const expressFee = express ? delivery.expressFee : 0;

  // A voucher discounts EITHER the goods or the delivery fee, never both — the same split
  // order.service.ts makes, capped against the bill component it belongs to. Folding a
  // FREE_SHIPPING waiver into the goods discount would cap it at the subtotal and show the
  // wrong number on a small order with a big fee. Express is excluded on purpose: the voucher
  // waives delivery, not a speed upgrade.
  const isFreeShipping = quote?.discountType === 'FREE_SHIPPING';
  const voucherValueDiscount = isFreeShipping ? 0 : quote?.discount ?? 0;
  const shippingDiscount = isFreeShipping ? Math.min(deliveryFee, quote?.discount ?? 0) : 0;
  /** What the voucher is worth on this bill, whichever component it lands on. */
  const voucherEffect = voucherValueDiscount + shippingDiscount;
  // Capped at the goods, exactly as order.service.ts caps it: a discount on what was bought may
  // never eat into the delivery fee. The shipping waiver is applied separately below.
  const goodsDiscount = Math.min(cart.subtotal, membershipDiscount + voucherValueDiscount);
  const estimatedTotal = cart.subtotal - goodsDiscount;
  const displayedTotal = estimatedTotal + deliveryFee + expressFee - shippingDiscount;

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

  const addressSection = (
    <>
    {/* Deliver to */}
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
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
              <Input id="recipientName" value={form.recipientName} onChange={set('recipientName')} />
            </Field>
            <Field label={t('order.checkout.phone')} htmlFor="phone">
              <Input id="phone" value={form.phone} onChange={set('phone')} inputMode="tel" />
            </Field>
          </div>
          <Field label={t('order.checkout.address')} htmlFor="addressLine">
            <Input id="addressLine" value={form.addressLine} onChange={set('addressLine')} placeholder={t('order.checkout.addressPlaceholder')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('order.checkout.city')} htmlFor="city">
              <Input id="city" value={form.city} onChange={set('city')} />
            </Field>
            <Field label={t('order.checkout.province')} htmlFor="province">
              <Input id="province" value={form.province} onChange={set('province')} />
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
    </div>
    </>
  );

  const depotSection = (
    <>
    {/* Depot picker — only when the address has no map pin to route from */}
    {needsDepotPick && (
      <div className="flex flex-col gap-3">
        <div>
              <p className="text-[12.5px] text-muted">{t('order.checkout.pickDepotHint')}</p>
        </div>
        {depotChoicesLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : depotChoices && depotChoices.items.length > 0 ? (
          <div data-testid="depot-picker" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {depotChoices.items.map((d) => (
              <RadioCard
                key={d.id}
                selected={pickedDepotId === d.id}
                onSelect={() => setPickedDepotId(d.id)}
              >
                <span className="block font-bold">{d.name}</span>
                <span className="block text-[12.5px] text-muted">
                  {d.city} · {d.code}
                </span>
              </RadioCard>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">{t('order.checkout.pickDepotEmpty')}</p>
        )}
      </div>
    )}
    </>
  );

  const paymentSection = (
    <>
    {/* Payment method */}
    <div className="flex flex-col gap-3">
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
    </div>
    </>
  );

  const windowSection = (
    <>

    {/* Delivery window (gap 13b) — express-now + date row + slots w/ capacity, advisory to depot */}
    <div className="flex flex-col gap-3">

      {/* Why "antar sekarang" is missing. The server already withdrew it (deliveryOptions
          applies the same test), so without a line here the option just silently vanishes. */}
      {depotState !== 'buka' && (
        <p className="rounded-2xl bg-[color:var(--surface-muted)] px-4 py-3 text-[13px] text-muted">
          {depotState === 'istirahat'
            ? t('hrFix.checkoutFix.depotOnBreak')
            : t('hrFix.checkoutFix.depotClosed')}
        </p>
      )}

      {/* Express-now — only where the depot actually offers it */}
      {delivery.expressEnabled && (
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
          <span className="block text-xs text-white/85">
            {t('customerFix.slot.expressEta', {
              min: delivery.expressEtaMinMinutes,
              max: delivery.expressEtaMaxMinutes,
            })}
          </span>
        </span>
        <span className="flex items-center gap-2 text-[13px] font-extrabold">
          {t('customerFix.slot.expressFee', { amount: formatIDR(delivery.expressFee) })}
          {express && <Check size={16} weight="bold" />}
        </span>
      </button>
      )}

      {delivery.expressEnabled && (
        <div className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">
          {t('customerFix.slot.orSchedule')}
        </div>
      )}

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
        {/* The windows this depot offers, in its own order. There is no capacity here: the
            list used to carry a hardcoded "Penuh" and a hardcoded "Sisa sedikit" that no
            depot had ever set, and a slot that lies about being full is worse than a slot
            that says nothing. */}
        {/* Not fail-soft like the reads above it: with no options the slot list is empty
            and express is withdrawn, so the buyer sees a depot that delivers at no time at
            all. Express staying off is correct (a fee we could not read must not be
            charged) — the missing windows are what needs saying. */}
        {optionsError && <LoadError onRetry={reloadOptions} />}
        {delivery.slots.map((slot) => {
          const on = !express && slotTime === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => {
                setSlotTime(slot);
                setExpress(false);
              }}
              aria-pressed={on}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                on
                  ? 'border-[1.5px] border-brand-600 bg-brand-50'
                  : 'border-app bg-[color:var(--surface)] hover:border-brand-300'
              }`}
            >
              <span>
                <span className="block text-sm font-bold">{slot}</span>
                <span className={`block text-[11.5px] ${on ? 'font-semibold text-brand-800' : 'text-muted'}`}>
                  {t(`customerFix.slot.${slotPeriod(slot)}`)}
                  {on && ` · ${t('customerFix.slot.selected')}`}
                </span>
              </span>
              {on ? (
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
    </div>
    </>
  );

  const voucherSection = (
    <>

    {/* Voucher — hidden for active resellers (flat reseller price, no stacking) */}
    {isReseller ? (
      <Card className="flex flex-col gap-2 rounded-[22px] p-[22px]">
        <Badge tone="success">
          {reseller!.flatGallonPriceIdr > 0
            ? `Harga agen Rp${reseller!.flatGallonPriceIdr.toLocaleString('id-ID')}/galon`
            : `Harga reseller −${reseller!.discountPct}%`}
        </Badge>
        <p className="text-sm text-muted">
          Diskon reseller berlaku otomatis. Voucher tidak bisa dipakai bersama harga reseller.
        </p>
      </Card>
    ) : (
    <div className="flex flex-col gap-3">
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
    </div>
    )}
    </>
  );

  const pickedDepot = depotChoices?.items.find((d) => d.id === pickedDepotId) ?? null;
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label;
  const PayIcon = PAY_ICONS[method];
  const savedSelected = savedAddresses?.find((a) => a.id === selection) ?? null;
  const addressSummary = savedSelected
    ? `${savedSelected.label} · ${savedSelected.addressLine}`
    : form.addressLine
      ? `${form.addressLine}${form.city ? `, ${form.city}` : ''}`
      : undefined;

  const SECTION_SHEETS: { key: SheetKey; titleKey: string; body: React.ReactNode }[] = [
    { key: 'address', titleKey: 'order.checkout.deliveryAddress', body: addressSection },
    { key: 'depot', titleKey: 'order.checkout.pickDepot', body: depotSection },
    { key: 'window', titleKey: 'order.checkout.deliveryWindow', body: windowSection },
    { key: 'payment', titleKey: 'order.checkout.paymentMethod', body: paymentSection },
    { key: 'voucher', titleKey: 'order.checkout.voucher', body: voucherSection },
  ];

  // One summary, two places: the rail at `lg:`, the sheet behind the sticky bar below it.
  const summaryBody = (
    <>
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
        {isReseller && (
          <div className="flex justify-between text-[color:var(--success)]">
            <span>{t('hrFix.checkoutFix.agentPrice')}</span>
            <span className="text-xs font-semibold">{t('hrFix.checkoutFix.computedAtOrder')}</span>
          </div>
        )}
        {voucherEffect > 0 && (
          <div className="flex justify-between text-[color:var(--success)]">
            <span>{t('order.checkout.voucherLabel', { code: quote?.code ?? '' })}</span>
            <span className="font-bold">
              −<Money amount={voucherEffect} />
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

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck size={15} weight="fill" className="mt-0.5 flex-shrink-0 text-brand-600" />
        {t('order.checkout.priceVerified')}
      </p>
    </>
  );

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

      {/* Below `sm:` the app bar carries this title. */}
      <h1 className="mb-5 hidden text-[30px] font-extrabold tracking-[-0.03em] sm:block">
        {t('order.checkout.title')}
      </h1>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* LEFT column — every part of the form is a row that opens its own sheet. The
            page used to be one 900-line scroll where the shape of the decision left to make
            was invisible; five rows say it in five lines. */}
        <div className="surface divide-y divide-[color:var(--border-soft)] rounded-2xl border border-app px-4">
          <ListRow
            icon={<MapPin size={18} weight="fill" className="text-brand-600" />}
            title={t('order.checkout.deliveryAddress')}
            subtitle={addressSummary}
            onClick={() => setSheet('address')}
          />
          {needsDepotPick && (
            <ListRow
              icon={<Storefront size={18} weight="fill" className="text-brand-600" />}
              title={t('order.checkout.pickDepot')}
              subtitle={pickedDepot?.name}
              onClick={() => setSheet('depot')}
            />
          )}
          <ListRow
            icon={<Clock size={18} weight="fill" className="text-brand-600" />}
            title={t('order.checkout.deliveryWindow')}
            subtitle={deliveryWindow || undefined}
            onClick={() => setSheet('window')}
          />
          <ListRow
            icon={<PayIcon size={18} weight="fill" className="text-brand-600" />}
            title={t('order.checkout.paymentMethod')}
            subtitle={methodLabel}
            onClick={() => setSheet('payment')}
          />
          <ListRow
            icon={<Tag size={18} weight="fill" className="text-brand-600" />}
            title={t('order.checkout.voucher')}
            subtitle={quote?.code}
            onClick={() => setSheet('voucher')}
          />
        </div>

        {/* RIGHT summary — a rail only where there is a column for one */}
        <Card className="hidden flex-col gap-3.5 rounded-[22px] p-6 lg:sticky lg:top-20 lg:flex">
          <h2 className="text-[17px] font-extrabold">{t('order.checkout.orderSummary')}</h2>
          {summaryBody}

          {submitError && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {submitError}
            </p>
          )}

          <Button
            type="submit"
            loading={submitting}
            disabled={needsDepotPick && !pickedDepotId}
            className="h-[54px] rounded-full text-[15px] font-extrabold"
          >
            {t('order.checkout.placeOrder')} <Money amount={displayedTotal} />
          </Button>
          {needsDepotPick && !pickedDepotId && (
            <p className="text-xs text-muted">{t('order.checkout.pickDepotRequired')}</p>
          )}
        </Card>
      </div>

      {/* Everywhere narrower the rail stacked under a form long enough that the total and
          the button that spends the money were never on screen together. */}
      {submitError && (
        <p className="mb-2 text-sm font-medium text-[color:var(--danger)] lg:hidden" role="alert">
          {submitError}
        </p>
      )}
      {needsDepotPick && !pickedDepotId && (
        <p className="mb-2 text-xs text-muted lg:hidden">{t('order.checkout.pickDepotRequired')}</p>
      )}
      {/* A direct child of the form on purpose: `sticky` only holds while its containing
          block is on screen, and a wrapper div is exactly as tall as the bar itself. */}
      <StickyActionBar className="lg:hidden" unstickAt="lg">
        <button
          type="button"
          onClick={() => setShowSummary(true)}
          className="flex min-w-0 flex-col items-start"
        >
          <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-muted">
            {t('order.checkout.orderSummary')}
            <CaretUp size={11} weight="bold" />
          </span>
          <Money amount={displayedTotal} className="text-[17px] font-extrabold" />
        </button>
        <Button
          type="submit"
          loading={submitting}
          disabled={needsDepotPick && !pickedDepotId}
          className="h-13 flex-1 rounded-full text-[15px] font-extrabold"
        >
          {/* Not `placeOrder`: that string ends in an em dash because the rail version is
              followed by the amount. The bar carries the total on its left already, so the
              dash would dangle. */}
          {t('order.checkout.placeOrderShort')}
        </Button>
      </StickyActionBar>

      {SECTION_SHEETS.map(({ key, titleKey, body }) => (
        <Sheet
          key={key}
          open={sheet === key}
          onClose={() => setSheet(null)}
          title={t(titleKey)}
          footer={
            <Button type="button" className="w-full" onClick={() => setSheet(null)}>
              {t('profile.addresses.form.save')}
            </Button>
          }
        >
          {body}
        </Sheet>
      ))}

      <Sheet
        open={showSummary}
        onClose={() => setShowSummary(false)}
        title={t('order.checkout.orderSummary')}
      >
        <div className="flex flex-col gap-3.5">{summaryBody}</div>
      </Sheet>
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
