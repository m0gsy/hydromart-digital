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
import { useQueryParam } from '@/lib/use-query-param';
import { voucherToApply } from '@/lib/vouchers';
import { endpoints } from '@/lib/endpoints';
import { addressToForm, numOrNull, pickDefaultAddress } from '@/lib/addresses';
import { defaultDepotFromLocation, resolveDeliveryDepot } from '@/lib/depots';
import { currentPosition, geoReason } from '@/lib/geo';
import { useLocation } from '@/lib/location-context';
import { depotOpenState } from '@/lib/opening-hours';
import { formatIDR } from '@/lib/format';
import { offeredMethods, PAYMENT_METHODS } from '@/lib/payments';
import { haptic } from '@/lib/platform';
import { memberDiscount, shippingFeeFor } from '@/lib/pricing';
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

// The one deliveryWindow value the server can recognise. order-service's sweep matches this
// exact string to tell "deliver now" from "deliver on a chosen day" — see EXPRESS_WINDOW in
// order.prisma.repository.ts, which must stay byte-identical (pinned by
// apps/web/test/express-window-constant.test.ts).
//
// This constant IS locale-independent, because express writes it directly. The scheduled
// slot strings around it are NOT: buildDates() below labels the first two days with
// t('customerFix.slot.today'/'tomorrow'), so an English browser stores "Today, 09.00-11.00".
// An earlier version of this comment claimed all of them were locale-independent literals,
// and the sweep query was written trusting it. Neither the day NOR the date survives into
// the row: "Kam, 09.00-11.00" does not say WHICH Thursday.
//
// ponytail: that is why the sweep protects every windowed order for the full 4-day booking
// horizon instead of reading the booked day — the booked day is not in the database. The
// upgrade path is a real `scheduledFor DateTime?` column; until it exists, no query can do
// better than this.
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
function slotPeriod(
  slot: string,
): 'periodMorning' | 'periodNoon' | 'periodAfternoon' | 'periodEvening' {
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
    const key =
      i === 0
        ? t('customerFix.slot.today')
        : i === 1
          ? t('customerFix.slot.tomorrow')
          : (days[d.getDay()] ?? '');
    return { key, num: d.getDate() };
  });
}

type SheetKey = 'address' | 'depot' | 'window' | 'payment' | 'voucher';

/** A manually typed address is unusable to a courier without these. */
// No province: the form stopped asking, so it cannot be required. City stays — crm-service
// segments campaigns on it.
const MANDATORY = ['recipientName', 'phone', 'addressLine', 'city'] as const;

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
  // The cart is fetched further down, once the fulfilling depot is known: it is priced BY
  // that depot (A2), so asking for it before the depot is resolved asks the wrong question.
  // Saved address book. Fail-soft: if this can't load, the customer just types a fresh
  // address (as before) — never blocks checkout, so the load error is intentionally ignored.
  const { data: savedAddresses } = useAsync<Address[]>(() =>
    api.get(endpoints.addresses.list, true),
  );
  // Voucher wallet — powers the min-spend progress bar (gap 13n) and the "usable now"
  // suggestions. Fail-soft: absence just hides those hints, never blocks checkout.
  const { data: myVouchers } = useAsync<MyVoucher[]>(() => api.get(endpoints.vouchers.me, true));
  /*
   * A4/A9. This screen used to read `/resellers/me` itself and re-derive the agen rule as
   * `active && (pct > 0 || flat > 0)` — the third copy of a rule order-service kept twice
   * more, and the only copy that never asked WHICH DEPOT. The server declines to price an
   * agen outside their own depot; this screen went on promising it. The rule is asked once
   * now, of the priced cart, so the badge and the bill cannot disagree.
   */

  /*
   * O5: only offer what this deployment can take. E-wallet and virtual account go through a
   * gateway that production does not have, so they were two buttons that could only fail
   * after the customer had already chosen how to pay. Cached: the answer is configuration,
   * not per-order state.
   */
  const { data: methodsAvailable } = useAsync<Record<string, boolean>>(() =>
    api.getCached(endpoints.payments.methods),
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

  // `null` = a fresh manually-typed address (no saved coordinates). Selecting a saved
  // address stashes its lat/lng, which lets order-service route the order to a depot
  // (per-depot pricing, delivery fee, stock reservation) — a manual address has none.
  const [selection, setSelection] = useState<'new' | string | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  /*
   * O2. How good the pin the customer just captured is, in metres, and whether the capture
   * is running or failed. Kept beside `coords` rather than inside it because it describes
   * the READING, not the point: a saved address carries coordinates with no accuracy at
   * all, and pretending otherwise would put a made-up number on screen.
   */
  const [pinAccuracy, setPinAccuracy] = useState<number | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [showManualPin, setShowManualPin] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  /*
   * The depots that could fulfil this address.
   *
   * SF-02 — the comment that stood here said this was "display-only and never sent to the
   * API or used in placeOrder". That stopped being true when A1 made the CART price itself
   * against the fulfilling depot: this answer now decides the price of every line, the
   * ongkir, the payment methods offered, and the depot the order is placed at.
   *
   * Which is why its FAILURE is no longer swallowed. When this read 502s the page used to
   * look completely normal — no error, no warning — while the cart fell back to catalog
   * prices and the customer read a total the depot would not charge. The error is surfaced
   * below, next to the money, with a retry.
   *
   * A3: ten candidates, not one. Service radii differ per depot, so the nearest depot is
   * not always the one that covers the point — asking for a single row made an out-of-range
   * depot the only answer and hid every in-range one behind it.
   */
  const {
    data: nearbyDepots,
    loading: nearbyLoading,
    error: nearbyError,
    reload: reloadNearby,
  } = useAsync<NearbyDepot[]>(
    () =>
      coords.latitude != null && coords.longitude != null
        ? api.get(
            endpoints.depots.nearby({ lat: coords.latitude, lng: coords.longitude, limit: 10 }),
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
    () =>
      needsDepotPick ? api.get(endpoints.depots.browse({ limit: 100 })) : Promise.resolve(null),
    [needsDepotPick],
  );

  // A pin arriving (saved address chosen) makes the manual choice meaningless — drop it.
  useEffect(() => {
    if (!needsDepotPick) setPickedDepotId(null);
  }, [needsDepotPick]);

  /*
   * G3. An address with no map pin still has a home location — the one set on Beranda,
   * which already resolved to a depot. Default the fulfilling depot to that one instead of
   * opening a hundred-row picker and blocking the order until somebody scrolls it.
   *
   * Only if that depot is still one of the choices: a stale id from an archived depot would
   * otherwise sail past the disabled-submit guard and come back DepotUnavailableError. The
   * picker below stays exactly as it was, as the override — this sets a default, it does
   * not take the decision away.
   */
  const { location } = useLocation();
  useEffect(() => {
    if (!needsDepotPick || pickedDepotId) return;
    const fromHome = defaultDepotFromLocation(location?.depotId, depotChoices?.items);
    if (fromHome) setPickedDepotId(fromHome);
  }, [needsDepotPick, pickedDepotId, location?.depotId, depotChoices]);

  // The depot that will fulfil this order, however it was determined. Everything the
  // summary quotes — ongkir, membership rate — is that depot's, so it is resolved once
  // here rather than per line.
  const depot = resolveDeliveryDepot(
    needsDepotPick,
    pickedDepotId,
    depotChoices?.items,
    nearbyDepots,
  );

  /*
   * L2.3: the method list is the platform's answer narrowed by THIS depot's. Derived here
   * rather than beside the fetch above because `depot` is only known at this point, and a
   * transfer to a depot with no account is a button that can only end in an unpayable order.
   */
  const payMethods = offeredMethods(methodsAvailable ?? null, depot);

  /*
   * A3. This address has a map pin and no depot's radius covers it. The server will refuse
   * the order for exactly this reason, so say it here rather than after the customer has
   * filled in the form, read a delivery fee, and pressed the button that spends money.
   *
   * `nearbyLoading` guards it: an empty list mid-fetch is not an out-of-area verdict.
   */
  const outOfServiceArea =
    !needsDepotPick && !nearbyLoading && nearbyDepots != null && depot === null;

  /*
   * A1/A2. The cart, priced by the depot that will actually fulfil the order — the depot's
   * own row, its active pricing rule, and any matching wholesale band, all resolved by the
   * same function checkout bills with. It used to be fetched with no depot at all and came
   * back at catalog base prices: measured Rp20.000 a galon on screen against Rp22.000
   * billed at a depot with a live +10% rule, and Rp105.000 against Rp30.000 for an agen
   * buying five. Re-read when the depot changes, because the price does.
   */
  const {
    data: cart,
    error,
    loading,
    reload,
  } = useAsync<Cart>(() => api.get(endpoints.cart.view(depot?.id ?? null), true), [depot?.id]);
  // A4: the agen rule, answered once by the server (see the note where it used to live).
  const isReseller = cart?.reseller?.applies === true;

  // Delivery windows and express pricing belong to the depot, not to this screen. Read for
  // the depot that will actually fulfil the order, so the surcharge shown is the one
  // order-service will charge — it used to be a constant here and nothing at all there.
  const {
    data: options,
    error: optionsError,
    reload: reloadOptions,
  } = useAsync<DeliveryOptions>(
    () => api.get(endpoints.orders.deliveryOptions(depot?.id ?? null), true),
    [depot?.id],
  );
  const delivery = options ?? NO_OPTIONS;

  // Buka / istirahat / tutup for the fulfilling depot, from the hours the public depot
  // projection already carries. It explains the missing express option AND, since W11,
  // gates the order itself — the server stays the authority on both.
  const depotState = depotOpenState(depot?.operatingHours, depot?.holidays);
  /*
   * A shut depot withdraws EXPRESS. It does not refuse the order.
   *
   * This gate briefly blocked everything, and that was wrong in a way the repo had already
   * written down three times — once in the same commit:
   *
   *   opening-hours.ts:5   "Deliberately NOT used to block scheduled orders: a customer may
   *                         order at 22:00 for tomorrow morning."
   *   order.service.ts:437  if (input.express && !expressAvailable) throw ...   ← express only
   *   order.prisma.repository.ts (W2b, same commit) gives a windowed order four days of
   *                         grace precisely so the 22:00-for-tomorrow order survives.
   *
   * The justification written here was that `expireAbandoned` would silently cancel the
   * 23:00 order by midnight. W2b removed that in the same commit, so this blocked orders to
   * avoid a bug that no longer existed — and the orders it blocked were the ones the
   * four-day scheduling window exists for.
   *
   * Measured cost while it was live: both real depots open 08:00-21:00, so checkout refused
   * money 11 hours a day, every day, at every depot. The server accepted those same orders
   * without complaint: the screen was stricter than the bill, in the direction of turning
   * customers away. order.service.ts's own comment says "the screen and the bill cannot
   * disagree about what was available" — they did.
   *
   * So the gate now matches the server exactly: only an EXPRESS order needs somebody at the
   * counter right now. `depot != null` stays load-bearing — an absent depot reads as SHUT
   * since W11, and without it this refuses while the nearby list is still loading or after
   * a failed `GET /depots`.
   */
  const depotClosed = depot != null && depotState === 'tutup';
  const expressBlocked = express && depotClosed;

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
      notes: '',
    });
  }

  // Editing an address field detaches from the saved coordinates (they no longer match).
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    // G2: the `notes` exception stays, and now it earns its keep — patokan is a visible
    // field on this form, and typing one must not throw away the pin that was just taken.
    if (k !== 'notes') {
      setCoords({ latitude: null, longitude: null });
      setPinAccuracy(null);
    }
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  /*
   * O2. The pin the address book requires. `latitude` and `longitude` are NOT optional on
   * customer-service's CreateAddressDto, and this screen's "Simpan alamat" checkbox posted
   * an address without either of them — so that request was a guaranteed 400, and the 400
   * went into an empty catch. The checkbox had never once saved an address.
   */
  async function capturePin() {
    setPinError(null);
    setPinBusy(true);
    try {
      const pos = await currentPosition();
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      // `accuracy` is metres, and it is the only honest way to say "is this pin any good"
      // without a map. A 2km reading and a 12m reading look identical on a coordinate pair.
      setPinAccuracy(Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null);
    } catch (err) {
      setPinError(t(`errors.geo.${geoReason(err)}`));
    } finally {
      setPinBusy(false);
    }
  }

  /*
   * K1.2: arrive with a voucher already chosen — the wallet links here with `?voucher=`.
   * `voucherToApply` owns the three conditions (see lib/vouchers), so this effect only
   * has to fire once.
   */
  const carriedVoucher = useQueryParam('voucher');
  const voucherApplied = useRef(false);
  useEffect(() => {
    const code = voucherToApply(carriedVoucher, !!cart, voucherApplied.current);
    if (!code) return;
    voucherApplied.current = true;
    void applyVoucher(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carriedVoucher, cart]);

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
      quotedAgainst.current = priceKey;
    } catch (err) {
      setVoucherError(err instanceof ApiError ? err.message : t('order.checkout.voucherInvalid'));
    } finally {
      setQuoting(false);
    }
  }

  /*
   * CA-3-12. A voucher quote is priced against a SUBTOTAL and a SHIPPING FEE, and both
   * belong to the depot. Change the depot — a different pricing rule, a different ongkir —
   * and the cart is re-read while the quote keeps the numbers it was asked about. The
   * screen then subtracted a discount the order would not grant: the total under the
   * button was not the bill.
   *
   * Re-asked whenever either input moves, rather than kept. A voucher that no longer
   * qualifies at this depot fails the re-ask and says so, which is the honest outcome —
   * better than a discount that evaporates at the payment screen.
   */
  /*
   * Empty while the cart still belongs to the PREVIOUS depot. Switching depot moves the
   * ongkir immediately and the subtotal only when the re-read lands, so without this the
   * quote is asked twice — once against a basket priced by one depot and delivered by
   * another, a combination that is never billed.
   */
  const priceKey =
    cart && cart.depotId === (depot?.id ?? null)
      ? `${depot?.id ?? ''}|${cart.subtotal}|${shippingFeeEstimate}`
      : '';
  const quotedAgainst = useRef<string>('');
  useEffect(() => {
    if (!quote || !priceKey || quotedAgainst.current === priceKey) return;
    void applyVoucher(voucherCode);
    // `quote` is deliberately not a dependency: re-quoting sets it, and watching it here
    // would re-enter this effect on its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

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
            latitude: coords.latitude ?? undefined,
            longitude: coords.longitude ?? undefined,
            notes: form.notes || undefined,
          },
          // Only meaningful without coordinates; with a pin, order-service routes itself.
          depotId: needsDepotPick ? (pickedDepotId ?? undefined) : undefined,
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
      /*
       * O2. Saving the address the customer just typed.
       *
       * This payload used to omit `latitude` and `longitude`, which are NOT optional on
       * customer-service's CreateAddressDto — so the request was a guaranteed 400, and the
       * 400 fell into an empty catch. The checkbox had never saved an address once, and
       * nothing anywhere said so. The pin is now taken on this screen, sent with the rest,
       * and a refusal is shown rather than eaten. Still non-blocking: the ORDER is placed,
       * and a failed book entry must not read as a failed purchase.
       */
      if (saveToBook && !savedAddresses?.some((a) => a.id === selection)) {
        try {
          await api.post(
            endpoints.addresses.create,
            {
              label: saveLabel.trim() || t('customerFix.checkout.defaultAddressLabel'),
              recipientName: form.recipientName,
              phone: form.phone,
              addressLine: form.addressLine,
              city: form.city,
              latitude: coords.latitude ?? undefined,
              longitude: coords.longitude ?? undefined,
              // K1.7: the patokan travels with the address, which is the whole point of
              // saving it — a courier reads it on every future order to this door.
              notes: form.notes.trim() || undefined,
            },
            true,
          );
        } catch (err) {
          setSaveError(
            err instanceof ApiError ? err.message : t('order.checkout.saveAddressFailed'),
          );
        }
      }

      /*
       * K1.7. A saved address whose patokan was corrected here used to keep the wrong one
       * forever: checkout filled the field FROM the address and never wrote back, so the
       * same bad direction was handed to the next courier, and the one after that. Written
       * back only when it actually changed, and only for an address that exists.
       */
      const chosen = savedAddresses?.find((a) => a.id === selection);
      if (chosen && form.notes.trim() !== (chosen.notes ?? '').trim()) {
        try {
          await api.patch(
            endpoints.addresses.detail(chosen.id),
            { notes: form.notes.trim() || null },
            true,
          );
        } catch {
          /* the order carries the corrected note either way; the book catches up next time */
        }
      }
      /*
       * G8. Starting the payment for the order that was just placed.
       *
       * This used to be swallowed by an empty catch and the customer was redirected to a
       * success page that then asked them to pay, with no explanation of why the payment
       * they had just chosen had not begun. The order really is valid, so this must not
       * read as a failed purchase — but silence is not the alternative.
       *
       * Staying on this screen is safe precisely because the idempotency key is still in
       * hand: pressing "Buat pesanan" again returns THIS order rather than buying the water
       * a second time, and takes another run at the payment.
       */
      try {
        await api.post(
          endpoints.payments.initiate,
          { orderId: order.id, method, amount: order.total },
          true,
        );
      } catch (err) {
        setSubmitError(
          err instanceof ApiError ? err.message : t('order.checkout.paymentStartFailed'),
        );
        setSubmitting(false);
        return;
      }
      /*
       * Cleared HERE, not the moment the order came back. Between those two points sit an
       * address save, a payment call and a navigation; anything that threw in that window
       * landed in the outer catch, which shows an error and re-enables the button — with no
       * key left. The next press would then be a genuinely new purchase of a cart that had
       * already been bought. The window is now empty.
       */
      attemptKey.current = '';
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
  // taught us once.
  // A7: through the app's one money rule, shared with the cart page and mirroring the
  // server's `money()`. Flooring showed Rp4.999 for a discount the order stored as Rp5.000 —
  // a preview that contradicts the bill, which is the defect the express fee taught us once.
  // Pinned by "membership discount rounds exactly like the server" in test/pricing.test.ts.
  const membershipDiscount = isReseller ? 0 : memberDiscount(cart.subtotal, membershipRate);
  /*
   * A4. The agen discount, computed server-side off the same priced lines the order bills
   * — the flat SOP price applies per galon line and excludes wholesale-band lines, and
   * this screen could see neither, so it used to show list price and a line reading
   * "dihitung saat pesan" over a total the bill then contradicted by Rp75.000 on a
   * five-galon basket. `null` when the cart came back at catalog prices: there is no
   * honest number to show then, and that wording is what the screen falls back to.
   */
  const resellerDiscount = isReseller ? (cart.reseller?.discount ?? null) : 0;

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
  /*
   * CA-3-13. An agen gets the flat SOP price INSTEAD of a voucher — `placeOrder` does not
   * even send the code. But reseller status is resolved per DEPOT, so a voucher applied
   * before the switch survived it, and the preview went on subtracting a discount the
   * order dropped. The quote stops counting the moment the agen price applies.
   */
  const activeQuote = isReseller ? null : quote;
  const isFreeShipping = activeQuote?.discountType === 'FREE_SHIPPING';
  const voucherValueDiscount = isFreeShipping ? 0 : (activeQuote?.discount ?? 0);
  const shippingDiscount = isFreeShipping ? Math.min(deliveryFee, activeQuote?.discount ?? 0) : 0;
  /** What the voucher is worth on this bill, whichever component it lands on. */
  const voucherEffect = voucherValueDiscount + shippingDiscount;
  // Capped at the goods, exactly as order.service.ts caps it: a discount on what was bought may
  // never eat into the delivery fee. The shipping waiver is applied separately below.
  const goodsDiscount = Math.min(
    cart.subtotal,
    membershipDiscount + voucherValueDiscount + (resellerDiscount ?? 0),
  );
  const estimatedTotal = cart.subtotal - goodsDiscount;
  const displayedTotal = estimatedTotal + deliveryFee + expressFee - shippingDiscount;

  // 13n — when a voucher fails, surface how far the cart is from eligibility. minSpend
  // comes from the wallet voucher matching the typed code (the value already in scope).
  const failedVoucher =
    voucherError && !quote
      ? (myVouchers?.find((v) => v.code === voucherCode.trim().toUpperCase()) ?? null)
      : null;
  const voucherShortfall =
    failedVoucher && failedVoucher.minSpend > cart.subtotal
      ? failedVoucher.minSpend - cart.subtotal
      : 0;
  const voucherProgressPct = failedVoucher
    ? Math.min(100, Math.round((cart.subtotal / failedVoucher.minSpend) * 100))
    : 0;
  /*
   * G7. Wallet vouchers that already clear this cart, offered as one-tap swaps.
   *
   * They used to appear only behind `voucherError` — that is, only after the customer had
   * typed a code wrong. The wallet was already fetched, and the answer to "do I have a
   * voucher I can use right now" was sitting in memory the whole time; it was shown only to
   * people who had just guessed. Nothing here is a new request.
   */
  const usableVouchers = (myVouchers ?? []).filter(
    (v) =>
      v.status === 'AVAILABLE' &&
      v.code !== voucherCode.trim().toUpperCase() &&
      v.minSpend <= cart.subtotal,
  );

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
                <Input
                  id="recipientName"
                  value={form.recipientName}
                  onChange={set('recipientName')}
                />
              </Field>
              <Field label={t('order.checkout.phone')} htmlFor="phone">
                <Input id="phone" value={form.phone} onChange={set('phone')} inputMode="tel" />
              </Field>
            </div>
            <Field label={t('order.checkout.address')} htmlFor="addressLine">
              <Input
                id="addressLine"
                value={form.addressLine}
                onChange={set('addressLine')}
                placeholder={t('order.checkout.addressPlaceholder')}
              />
            </Field>
            {/* City only. Province and postcode were two required fields on the screen a
              customer cannot skip, and nothing downstream read either one — not the depot
              match (distance), not the price, not the courier. City stays because
              crm-service segments campaigns on it. */}
            <Field label={t('order.checkout.city')} htmlFor="city">
              <Input id="city" value={form.city} onChange={set('city')} />
            </Field>
            {/* O2. The pin, on the screen that needs it. The address book has required one all
              along; this form simply never offered a way to take it, so every "Simpan
              alamat" here was a 400 nobody saw. Same one-tap control as /addresses — no map
              picker, and raw lat/lng is jargon to someone ordering water. */}
            <div className="flex flex-col gap-2.5 rounded-2xl border border-app bg-[color:var(--surface-soft)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin size={16} weight="fill" className="text-brand-600" />
                {t('profile.addresses.pin.title')}
                <span className="text-xs font-normal text-muted">
                  {saveToBook
                    ? t('profile.addresses.pin.required')
                    : t('profile.addresses.pin.optional')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={pinBusy}
                  onClick={capturePin}
                  className="rounded-full px-3.5 py-1.5 text-[13px]"
                >
                  {t('profile.addresses.pin.useLocation')}
                </Button>
                {coords.latitude != null && (
                  <span className="text-[13px] font-semibold text-[color:var(--success)]">
                    {t('profile.addresses.pin.pinned')}
                  </span>
                )}
              </div>
              {/* A coordinate pair cannot be judged by a human. These two lines can: how tight
                the reading was, and which depot it lands next to. Both are already in hand —
                `accuracy` from the same fix, the depot from the nearby lookup this screen
                already runs. No map, no reverse-geocode, no new data leaving the device. */}
              {coords.latitude != null && (
                <p className="text-xs leading-relaxed text-muted">
                  {pinAccuracy != null &&
                    t('order.checkout.pinAccuracy', { m: Math.round(pinAccuracy) })}
                  {nearbyDepots?.[0] && (
                    <>
                      {pinAccuracy != null ? ' · ' : ''}
                      {t('order.checkout.pinNearDepot', {
                        depot: nearbyDepots[0].name,
                        km: nearbyDepots[0].distanceKm.toFixed(1),
                      })}
                    </>
                  )}
                </p>
              )}
              {pinError && (
                <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
                  {pinError}
                </p>
              )}
              {/*
              The way out when the phone cannot answer.
              `/addresses` has had this since it shipped; checkout had the same button, the
              same failure and no second door — so a WebView that could not produce a fix
              (reported from a real OPPO, 2 September 2026) left the pin permanently empty,
              and with "simpan alamat" ticked that is a required field nothing can fill.
              Shown only after a failure: nobody types coordinates by choice.
            */}
              {pinError && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowManualPin((v) => !v)}
                    className="self-start text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {showManualPin
                      ? t('profile.addresses.pin.hideManual')
                      : t('profile.addresses.pin.showManual')}
                  </button>
                  {showManualPin && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Latitude"
                        htmlFor="ck-lat"
                        hint={t('profile.addresses.form.latHint')}
                      >
                        <Input
                          id="ck-lat"
                          inputMode="decimal"
                          placeholder="-6.9147"
                          value={coords.latitude ?? ''}
                          onChange={(e) =>
                            setCoords((c) => ({ ...c, latitude: numOrNull(e.target.value) }))
                          }
                        />
                      </Field>
                      <Field
                        label="Longitude"
                        htmlFor="ck-lng"
                        hint={t('profile.addresses.form.lngHint')}
                      >
                        <Input
                          id="ck-lng"
                          inputMode="decimal"
                          placeholder="107.6098"
                          value={coords.longitude ?? ''}
                          onChange={(e) =>
                            setCoords((c) => ({ ...c, longitude: numOrNull(e.target.value) }))
                          }
                        />
                      </Field>
                    </div>
                  )}
                </>
              )}
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
              {/* The confirmation step: what is about to be written, in words, before it is
                written. A checkbox alone asked someone to agree to something invisible. */}
              {saveToBook && coords.latitude == null && (
                <p className="text-xs font-medium text-[color:var(--danger)]">
                  {t('order.checkout.savePinRequired')}
                </p>
              )}
              {saveError && (
                <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
                  {saveError}
                </p>
              )}
              {saveToBook && (
                <Field
                  label={t('order.checkout.addressLabel')}
                  htmlFor="saveLabel"
                  hint={t('order.checkout.addressLabelHint')}
                >
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

        {/*
        G2. The patokan, as an ordinary always-visible field.

        It used to be a tap-to-edit row: the value rendered as truncated grey text next to an
        "Ubah" link, which is how a form asks to be skipped. It is the one line on this
        screen written for the person who has to FIND the door, and on a saved address it is
        also the line K1.7 now writes back — a field that has to be discovered by tapping is
        the wrong home for either job.
      */}
        <Field
          label={t('order.checkout.courierNotes')}
          htmlFor="courierNotes"
          hint={t('order.checkout.courierNotesHint')}
        >
          <Input
            id="courierNotes"
            value={form.notes}
            onChange={set('notes')}
            placeholder={t('order.checkout.courierNotesPlaceholder')}
            maxLength={200}
          />
        </Field>
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
          {payMethods.map((m) => {
            const Icon = PAY_ICONS[m.value];
            const on = method === m.value;
            return (
              <RadioCard
                key={m.value}
                selected={on}
                onSelect={() => setMethod(m.value)}
                className="items-center"
              >
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[11px] bg-brand-50">
                  <Icon size={18} weight="fill" className="text-brand-600" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-extrabold">{t(m.label)}</span>
                  <span className="block text-xs text-muted">{t(m.hint)}</span>
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
              express
                ? 'bg-gradient-to-br from-brand-800 to-brand-600 text-on-brand shadow-lift'
                : 'bg-gradient-to-br from-brand-800 to-brand-600 text-on-brand opacity-90 hover:opacity-100'
            }`}
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Lightning size={24} weight="fill" />
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-extrabold">
                {t('customerFix.slot.expressNow')}
              </span>
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
                  on
                    ? 'bg-[color:var(--text)] text-[color:var(--surface)]'
                    : 'border border-app bg-[color:var(--surface)]'
                }`}
              >
                <span
                  className={`block text-[11px] font-semibold ${on ? 'text-[color:var(--surface)]/70' : 'text-muted'}`}
                >
                  {d.key}
                </span>
                <span className="mt-0.5 block text-[15px] font-extrabold tabular-nums">
                  {d.num}
                </span>
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
                  <span
                    className={`block text-[11.5px] ${on ? 'font-semibold text-brand-800' : 'text-muted'}`}
                  >
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
            {cart.reseller!.flatGallonPriceIdr > 0
              ? t('customerFix.checkout.agentPrice', {
                  amount: cart.reseller!.flatGallonPriceIdr.toLocaleString('id-ID'),
                })
              : t('customerFix.checkout.resellerDiscount', { pct: cart.reseller!.discountPct })}
          </Badge>
          <p className="text-sm text-muted">{t('order.checkout.resellerNoVoucher')}</p>
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
            <p
              className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--danger)]"
              role="alert"
            >
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
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${voucherProgressPct}%` }}
                />
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
                    <div className="font-mono text-[13px] font-bold tracking-[0.06em]">
                      {v.code}
                    </div>
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
  const methodLabelKey = PAYMENT_METHODS.find((m) => m.value === method)?.label;
  const methodLabel = methodLabelKey ? t(methodLabelKey) : undefined;
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
        {/* A1: catalog prices are labelled, never passed off as the depot's. */}
        {cart.pricingBasis === 'CATALOG' && (
          <p className="text-xs text-muted">{t('customerFix.checkout.catalogPricing')}</p>
        )}
        {membershipDiscount > 0 && (
          <div className="flex justify-between text-[color:var(--success)]">
            <span>
              {t('order.checkout.memberDiscount', { pct: Math.round(membershipRate * 100) })}
            </span>
            <span className="font-bold">
              −<Money amount={membershipDiscount} />
            </span>
          </div>
        )}
        {isReseller && (
          <div className="flex justify-between text-[color:var(--success)]">
            <span>{t('hrFix.checkoutFix.agentPrice')}</span>
            {resellerDiscount === null ? (
              <span className="text-xs font-semibold">
                {t('hrFix.checkoutFix.computedAtOrder')}
              </span>
            ) : (
              <span className="font-bold">
                −<Money amount={resellerDiscount} />
              </span>
            )}
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
            <span className="text-muted">
              {t('order.checkout.deliveryEst', { name: depot.name })}
            </span>
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
      {/* G5. A three-step progress stepper used to sit here, pinned to step 2 forever: step
          one always ticked, step three always grey, and no route in the app renders either
          of the other two states. It measured progress through a flow that has one screen,
          so the only thing it could ever say was "you are here", which the screen already
          says. Removed rather than wired up — there is no second and third page to wire it
          to. */}
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
            /* G4. Empty here is not "unanswered" — it is the ASAP default, which is a real
               choice the order is placed with. A blank subtitle read as a field left
               undone, next to four rows that all carry one. */
            subtitle={deliveryWindow || t('order.checkout.slotAsap')}
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
            subtitle={activeQuote?.code}
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
            disabled={(needsDepotPick && !pickedDepotId) || outOfServiceArea || expressBlocked}
            className="h-[54px] rounded-full text-[15px] font-extrabold"
          >
            {t('order.checkout.placeOrder')} <Money amount={displayedTotal} />
          </Button>
          {needsDepotPick && !pickedDepotId && (
            <p className="text-xs text-muted">{t('order.checkout.pickDepotRequired')}</p>
          )}
          {outOfServiceArea && (
            <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
              {t('order.checkout.outOfServiceArea')}
            </p>
          )}
          {depotClosed && (
            <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
              {t('hrFix.checkoutFix.depotClosed')}
            </p>
          )}
          {/* SF-02: the depot lookup failed, so nothing on this screen is the depot's price. */}
          {nearbyError && (
            <div className="flex flex-col gap-1" role="alert">
              <p className="text-xs font-medium text-[color:var(--danger)]">
                {t('customerFix.checkout.depotLookupFailed')}
              </p>
              <button
                type="button"
                onClick={reloadNearby}
                className="self-start text-xs font-bold text-brand-700 underline"
              >
                {t('customerFix.checkout.retryDepotLookup')}
              </button>
            </div>
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
      {outOfServiceArea && (
        <p className="mb-2 text-xs font-medium text-[color:var(--danger)] lg:hidden" role="alert">
          {t('order.checkout.outOfServiceArea')}
        </p>
      )}
      {depotClosed && (
        <p className="mb-2 text-xs font-medium text-[color:var(--danger)] lg:hidden" role="alert">
          {t('hrFix.checkoutFix.depotClosed')}
        </p>
      )}
      {/* A direct child of the form on purpose: `sticky` only holds while its containing
          block is on screen, and a wrapper div is exactly as tall as the bar itself. */}
      <StickyActionBar className="lg:hidden" unstickAt="lg">
        <button
          type="button"
          onClick={() => setShowSummary(true)}
          className="flex min-h-11 min-w-0 flex-col items-start justify-center"
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
          disabled={(needsDepotPick && !pickedDepotId) || outOfServiceArea || expressBlocked}
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
            /* O2. This button closes the sheet. It said "Simpan" on all five of them —
               including the voucher and payment sheets, which save nothing either — so the
               word promised a write that no code anywhere performed. Everything in these
               sheets is already held in form state; the only thing that ever writes is
               "Buat pesanan". */
            <Button type="button" className="w-full" onClick={() => setSheet(null)}>
              {t('common.done')}
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
