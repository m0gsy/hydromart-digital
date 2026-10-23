'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUUpLeft, Lock, Money as MoneyIcon, Printer } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { CashierShiftBar } from '@/components/dashboard/cashier-shift-bar';
import { QuantityStepper } from '@/components/quantity-stepper';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import {
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  Money,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { computeEffective } from '@/lib/pricing';
import { buildReceiptModel, printReceipt } from '@/lib/receipt';
import { useDepotContact } from '@/lib/use-depot-contact';
import { thermalErrorKey } from '@/lib/receipt-thermal';
import { PrinterSetup } from '@/components/dashboard/printer-setup';
import { CounterPromoStrip } from '@/components/dashboard/counter-promos';
import { CounterHeldBaskets } from '@/components/dashboard/counter-held-baskets';
import { CounterShiftTally } from '@/components/dashboard/counter-shift-tally';
import {
  MAX_HELD,
  addHeld,
  loadHeld,
  removeHeld,
  restoreQuantities,
  saveHeld,
  type HeldBasket,
} from '@/lib/held-baskets';
import { receiptToText, whatsappUrl } from '@/lib/receipt-text';
import { openExternal } from '@/lib/platform';
import { canRecordWalkInSale } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
  CounterCustomerLookup,
  CounterQuote,
  DepotPaymentPanel,
  InventoryItem,
  MyVoucher,
  Order,
  Page,
  Payment,
  Product,
  PromoRule,
  ResolvedPrice,
  CashierShift,
} from '@/lib/types';

/** What a buyer can settle with at the counter. All three are confirmed by the cashier. */
type CounterMethod = 'CASH' | 'QRIS' | 'TRANSFER';

/**
 * K3.2: a sale that is recorded but not paid for, kept on screen until it is.
 *
 * `paymentId` is what makes the retry idempotent: once initiate has answered, the retry
 * only confirms — it never asks for a second row against the same order.
 */
type Unpaid = {
  order: Order;
  method: CounterMethod;
  cashReceived: number;
  paymentId: string | null;
};

/**
 * Counter sale: the customer is standing at the depot, pays cash, takes the galon.
 * Records the sale so stock, reports and franchise revenue see it — no cart, no courier.
 *
 * Phone is optional. Given one, the buyer is resolved (or pre-registered) first so points
 * land on a real account; left blank the sale is anonymous, which earns nothing.
 */
/**
 * C14: how often the till re-reads what the depot can actually hand over.
 *
 * Coarse deliberately. The screen already refetches prices on every stepper tap, and this
 * repo has a 429-cascade in its history — a tighter loop buys accuracy nobody can act on
 * faster than they can scan a barcode.
 */
const STOCK_REFRESH_MS = 20000;
/** At or below this the row says how many are left, so the stepper stopping is no surprise. */
const LOW_STOCK = 5;
/** A number is worth looking up once it could plausibly be a whole one. */
const LOOKUP_MIN_DIGITS = 9;
const LOOKUP_DEBOUNCE_MS = 500;
/** Notes an Indonesian buyer actually hands over — same list the courier COD screen uses. */
const NOTES = [50000, 100000, 150000, 200000];

function WalkIn({ depotId }: { depotId: string }) {
  const { t, locale } = useT();
  const { customer: me } = useAuth();
  // Held baskets belong to this cashier at this depot, not to whoever uses the browser next.
  const heldScope = `${depotId}.${me?.id ?? 'anon'}`;
  // K3.4: the depot record behind `depotId`, for the outlet line on the struk.
  const { depots } = useDepot();
  const depot = depots.find((d) => d.id === depotId) ?? null;
  // The depot's own line for the struk — the public projection above leaves it out.
  const depotContact = useDepotContact(depotId);
  const { toast } = useToast();
  const [printerOpen, setPrinterOpen] = useState(false);
  // The struk was already shared as a file; this only says why the printer stayed quiet.
  const thermalFailed = (f: { code: string }) => toast(t(thermalErrorKey(f.code)), 'error');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cash, setCash] = useState('');
  const [voucher, setVoucher] = useState('');
  // #27: how many empty galon the buyer handed over for THIS sale. '' means not asked yet —
  // kept as a string so an empty box is distinct from a typed 0, and parsed only at submit.
  const [emptiesReturned, setEmptiesReturned] = useState('');
  /*
   * C11: the buyer came to the counter and asked for it to be delivered.
   *
   * Presence of an address is the whole signal, server-side and here — no new mode and no
   * second route. The fields are only collected when the toggle is on, because the sale DTO
   * requires all four and a cashier typing them for every pick-up would stop using the till.
   */
  const [deliver, setDeliver] = useState(false);
  const [addrName, setAddrName] = useState('');
  const [addrPhone, setAddrPhone] = useState('');
  const [addrLine, setAddrLine] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrNotes, setAddrNotes] = useState('');
  /**
   * C12: the buyer, once the cashier has DELIBERATELY looked them up.
   *
   * Never derived from the phone field as it is typed. `resolveByPhone` mints an account,
   * so quoting per keystroke would print a customer for every number anyone ever half-typed
   * — people who bought nothing, in the broadcast audience, who will never turn the opt-out
   * off because nobody is behind them. One tap, one account, and only when the cashier says
   * this is the buyer.
   */
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  // Baskets set aside while a buyer fetches their money. Read after mount: this is a browser
  // store, and the page is also rendered once on the server.
  const [held, setHeld] = useState<HeldBasket[]>([]);
  useEffect(() => setHeld(loadHeld(heldScope)), [heldScope]);
  // What the typed number already is, if anything. Read-only: it never creates an account.
  const [lookup, setLookup] = useState<CounterCustomerLookup | null>(null);
  // Bumped after every sale and void so the shift tally follows without a poll.
  const [salesTick, setSalesTick] = useState(0);
  useEffect(() => {
    setLookup(null);
    // Once identified, the account is known and "Cek pelanggan" has answered; asking again
    // would only repeat it.
    if (buyerId || phone.replace(/\D/g, '').length < LOOKUP_MIN_DIGITS) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .get<CounterCustomerLookup>(endpoints.auth.customerCounterLookup(phone.trim()), true)
        .then((r) => alive && setLookup(r))
        // A hint, never a gate: a malformed number or a down service just shows nothing.
        .catch(() => alive && setLookup(null));
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phone, buyerId]);
  const [method, setMethod] = useState<CounterMethod>('CASH');
  const [busy, setBusy] = useState(false);
  /** Idempotency key for the sale being rung up; cleared once it is recorded. */
  /**
   * B-13: one key per till attempt, deliberately NOT cleared when a submit fails — that is
   * what makes a retry after a timeout return the sale already recorded instead of selling
   * the goods twice.
   *
   * C8: but it must not survive a change of BASKET. The cashier who fixed a quantity or
   * dropped a line after a failure was sending new goods under the old key, and the server
   * handed back the first order — a receipt for goods that were never on the counter. The
   * effect below retires the key whenever the basket changes, so the same key never
   * describes two different sales.
   */
  const attemptKey = useRef('');
  // Mirrors the server's own rule: no open shift, no counter sale. Undefined until the bar
  // has looked — the button stays enabled so a slow check never blocks a queue of buyers,
  // and the server refuses anyway if there really is no shift.
  /*
   * K3.4: the whole shift, not just whether one is open. The struk has to name the till
   * that printed it — a customer coming back with a complaint used to hold a piece of
   * paper that named no outlet, no cashier and no shift.
   */
  const [shift, setShift] = useState<CashierShift | null | undefined>(undefined);
  const shiftOpen = shift === undefined ? undefined : shift !== null;
  // A basket held across a closed drawer belongs to a sale that can no longer be made. Only
  // the open -> closed move counts: "no shift yet" on arrival is not a close.
  const wasShiftOpen = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (wasShiftOpen.current === true && shiftOpen === false) {
      saveHeld(heldScope, []);
      setHeld([]);
    }
    wasShiftOpen.current = shiftOpen;
  }, [shiftOpen, heldScope]);
  /**
   * K3.4: who sold this, for the struk. Built at print time rather than stored, so a
   * receipt reprinted after the shift closed still names the shift it was rung up in.
   */
  const outlet = () => ({
    depotName: depot?.name ?? null,
    depotCity: depot?.city ?? null,
    depotPhone: depotContact?.phone ?? null,
    cashierName: shift?.cashierName ?? null,
    shiftId: shift?.id ?? null,
  });
  /** C6: WHICH sale is being voided — not merely "the void sheet is open". */
  const [voiding, setVoiding] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState('');
  // The sale just recorded, kept so its receipt can be printed again — the print window is a
  // popup and a blocked one used to lose the struk with the form already cleared.
  const [lastSale, setLastSale] = useState<{
    order: Order;
    cash?: { cashReceived: number; change: number };
    method: CounterMethod;
    /** As typed at the till, for "kirim struk"; the sale form is cleared by then. */
    phone: string;
  } | null>(null);
  /** K3.2: the sale whose money is in the drawer but not yet in the ledger. */
  const [unpaid, setUnpaid] = useState<Unpaid | null>(null);

  // What this depot can actually hand over. Read FIRST, because it is also the list of
  // products the till is allowed to name (see `catalog` below).
  const stock = useAsync<InventoryItem[]>(
    () => api.get(endpoints.inventory.lines(depotId), true),
    [depotId],
  );
  const stockedIds = useMemo(
    () =>
      (stock.data ?? [])
        .filter((line) => line.productId && line.available > 0)
        .map((line) => line.productId as string),
    [stock.data],
  );
  /*
   * K3.5: the till used to take page one of the GLOBAL catalogue — `browse({limit:100})`,
   * ordered `createdAt desc` — and filter it by what this depot stocks. 100 is the server's
   * own maximum in two independent places, so there was no bigger page to ask for; the
   * moment the network catalogue passed 100 active products the OLDEST SKUs stopped being
   * on it, and the oldest SKU is AIR-GALON-19L — the product the business is. A depot with
   * five stock lines would have shown an empty till and no error at all.
   *
   * The depot's own stock list is not paginated server-side, so this screen was already
   * holding the complete, authoritative list of what it may sell and throwing it away
   * against a truncated catalogue. Ask for those ids by name instead: one call, no page
   * size to outgrow, no search box, no pagination controls.
   */
  const catalog = useAsync<Product[]>(
    () =>
      stockedIds.length === 0 ? Promise.resolve([]) : api.get(endpoints.products.batch(stockedIds)),
    [stockedIds.join(',')],
  );

  /**
   * C14: the number on this screen was stale from the FIRST sale, and so was the stepper's
   * ceiling.
   *
   * `stock` only ever reloaded on a depot switch, a void, a retry after an error, or
   * `useAsync`'s own resume-after-60-seconds-backgrounded. A successful `submit()` never
   * reloaded it — and the server computes `available = quantity - reserved`, with every
   * walk-in reserving. So one sale by ONE cashier was enough: sell 10 of a stock of 12 and
   * the stepper still offered 12, the cashier kept selling goods that were gone, and the
   * reservation refused them AFTER the buyer had agreed a price.
   *
   * Two triggers, because they answer different failures: the interval covers the OTHER
   * cashier (the shift index is unique per (depot, cashier), so two tills at one depot is
   * normal), and the post-sale reload covers this one.
   *
   * Coarse on purpose. This screen is already chatty — `resolved` refetches on every
   * stepper tap — and this repo has a 429-cascade in its history. `reloadRef` because
   * `useAsync.reload` is not memoised, exactly as `dashboard/tracking` does it.
   */
  /**
   * C6: this depot's own recent counter sales, from the server rather than from React
   * state — which is what makes the void endpoint reachable after a refresh, and what turns
   * the same list into the void report the application never had.
   *
   * `/orders/manage` already scopes to the caller's depot, so this is not a new way to see
   * another depot's takings. Small page: a till needs the last few, not a ledger.
   */
  const recent = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.manage({ depotId, isWalkIn: true, limit: 8 }), true),
    [depotId],
  );

  const stockReloadRef = useRef(stock.reload);
  stockReloadRef.current = stock.reload;
  const promosReloadRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const t = setInterval(() => {
      stockReloadRef.current();
      // A promo whose hours ended at noon should not still be on offer at one.
      promosReloadRef.current();
    }, STOCK_REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const availableById = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of stock.data ?? []) {
      if (line.productId) map.set(line.productId, line.available);
    }
    return map;
  }, [stock.data]);
  const products = useMemo(
    () => (catalog.data ?? []).filter((p) => (availableById.get(p.id) ?? 0) > 0),
    [catalog.data, availableById],
  );
  const ids = products.map((p) => p.id);
  const productNameById = useMemo(() => {
    const m = new Map((catalog.data ?? []).map((p) => [p.id, p.name]));
    return (id: string) => m.get(id);
  }, [catalog.data]);
  // The strip is a courtesy: a failed load shows nothing rather than blocking the till.
  const livePromos = useAsync<PromoRule[]>(
    () => api.get(endpoints.promoRules.active(depotId), true),
    [depotId],
  );
  promosReloadRef.current = livePromos.reload;
  // Quantities go with the ids so a wholesale band is priced for what is actually being sold
  // (design 16b). Without them the till quoted the list price for a 20-galon sale the order
  // then stored at the bulk price — the cashier collected Rp60.000 too much.
  const askQty = products.map((p) => qty[p.id] ?? 0);
  const resolved = useAsync<ResolvedPrice[]>(
    () =>
      ids.length ? api.get(endpoints.inventory.prices(depotId, ids, askQty)) : Promise.resolve([]),
    [depotId, ids.join(','), askQty.join(',')],
  );

  // Prices shown here are the same ones checkout would charge: depot override + active rule.
  const priceById = useMemo(() => {
    const byId = new Map((resolved.data ?? []).map((r) => [r.productId, r]));
    return new Map(
      products.map((p) => [p.id, computeEffective(p.basePrice, byId.get(p.id)).effective]),
    );
  }, [products, resolved.data]);

  const lines = products
    .map((p) => ({ product: p, quantity: qty[p.id] ?? 0 }))
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      ...l,
      lineTotal: (priceById.get(l.product.id) ?? l.product.basePrice) * l.quantity,
    }));
  /** Shelf prices at this depot — now a SUBTOTAL line, not the number the till charges. */
  // C8: a different basket is a different sale, so it gets a different key. Keyed on the
  // basket itself rather than on any one control, because every way of editing it — the
  // stepper, clearing a line, switching depot — has the same consequence.
  const basketKey = lines.map((l) => `${l.product.id}:${l.quantity}`).join('|');
  useEffect(() => {
    attemptKey.current = '';
  }, [basketKey]);

  // #27: how many galon this basket actually sells — the ceiling the empties box is bound
  // to, and whether the question is worth asking at all.
  const galonQty = lines.filter((l) => l.product.isGallon).reduce((sum, l) => sum + l.quantity, 0);
  useEffect(() => {
    setEmptiesReturned('');
  }, [basketKey]);

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  /**
   * C12: what this basket actually costs, answered by the server.
   *
   * The screen used to add up shelf prices while the server applied tier, agen price and
   * voucher on top. Three numbers in three places: the cash-short guard used THIS one, so
   * an agen handing over exact money was refused by the till; the change here disagreed
   * with the change on the receipt; and a cashier who trusted the screen collected more
   * than was recorded — a phantom surplus at shift close.
   *
   * Runs the same function the sale runs. An invalid voucher fails HERE, before Bayar,
   * instead of after the goods have left the counter.
   */
  /**
   * C12: look the buyer up, because the cashier asked. The only call in this screen that
   * can mint an account. Re-quoting then applies their tier or agen band — the badge and
   * the discount both come from that one server read rather than being guessed here.
   */
  async function identifyBuyer() {
    if (!phone.trim()) return;
    setIdentifying(true);
    try {
      const found = await api.post<{ customerId: string }>(
        endpoints.orders.walkInIdentify,
        { depotId, phone: phone.trim(), name: name.trim() || undefined },
        true,
      );
      setBuyerId(found.customerId);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('opsFix.walkIn.identifyFailed'), 'error');
    } finally {
      setIdentifying(false);
    }
  }

  /*
   * Complete or nothing. A half-filled address quotes an ongkir the sale would then refuse
   * with a 400, which at a till means the cashier has already told someone a price.
   * `recipientName`/`phone` fall back to the buyer fields above so the common case is three
   * boxes, not five.
   */
  const deliveryAddress =
    deliver && addrLine.trim() && addrCity.trim()
      ? {
          recipientName: (
            addrName.trim() ||
            name.trim() ||
            t('opsFix.walkIn.deliverRecipientFallback')
          ).slice(0, 120),
          phone: (addrPhone.trim() || phone.trim()).slice(0, 20),
          addressLine: addrLine.trim().slice(0, 255),
          city: addrCity.trim().slice(0, 100),
          notes: addrNotes.trim() ? addrNotes.trim().slice(0, 255) : undefined,
        }
      : null;
  // The phone is required by the sale DTO too, so an address without one is not sendable.
  const deliveryReady = deliveryAddress !== null && deliveryAddress.phone.length > 0;

  const quote = useAsync<CounterQuote | null>(
    () =>
      lines.length === 0
        ? Promise.resolve(null)
        : api.post<CounterQuote>(
            endpoints.orders.walkInQuote,
            {
              depotId,
              lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
              customerId: buyerId ?? undefined,
              voucherCode: voucher.trim() || undefined,
              // C11: the quote has to know, or the till shows a pick-up total and charges a
              // delivery one — they differ by exactly the ongkir.
              deliveryAddress: deliveryReady ? deliveryAddress : undefined,
            },
            true,
          ),
    [
      depotId,
      lines.map((l) => `${l.product.id}:${l.quantity}`).join(','),
      buyerId,
      voucher.trim(),
      // Re-quote when delivery is switched on or off, and when the address first becomes
      // complete — the fee is per galon, so it moves with the basket as well.
      deliveryReady,
    ],
  );

  // Offered only for a buyer the cashier deliberately identified: the list is that buyer's
  // own granted codes, so there is nothing to show (and nothing to fetch) before then. A
  // failure leaves the typed field, which always worked.
  const grantedVouchers = useAsync<MyVoucher[]>(
    () =>
      buyerId ? api.get(endpoints.vouchers.counter(buyerId, depotId), true) : Promise.resolve([]),
    [buyerId, depotId],
  );
  const offeredVouchers = buyerId ? (grantedVouchers.data ?? []) : [];

  // No silent fall back to shelf prices: a total the server did not agree to is exactly the
  // bug this replaces. The Bayar button is disabled instead, and the reason is on screen.
  const total = quote.data?.totalIdr ?? null;
  /*
   * `useAsync` keeps the previous answer while the next one is in flight, and after it
   * failed. So `total` right after a stepper tap (or an invalid voucher) is the PREVIOUS
   * basket's number: the cash guard compared against it, the buyer was handed the goods,
   * and the shortfall only surfaced when the payment was confirmed. The number may still be
   * shown (no flicker), but it may only be charged once it belongs to this basket.
   */
  const quoteFresh = !quote.loading && !quote.error;
  // What the empties box means for the report: a swap of all, some, or none. Informational —
  // the sale is the same either way; only how it is counted differs.
  const emptiesNum = Number(emptiesReturned);
  const emptiesTyped = emptiesReturned.trim() === '' || Number.isNaN(emptiesNum) ? null : emptiesNum;
  const emptiesHint =
    emptiesTyped === null || emptiesTyped >= galonQty
      ? t('opsFix.reports.emptiesReturnedHint')
      : emptiesTyped > 0
        ? t('opsFix.walkIn.emptiesSplit', {
            x: emptiesTyped,
            y: galonQty,
            z: galonQty - emptiesTyped,
          })
        : t('opsFix.walkIn.emptiesNone', { y: galonQty });
  // One definition for the button and for Enter in the cash box, so the keyboard can never
  // sell something the button would have refused.
  const payDisabled =
    busy || lines.length === 0 || shiftOpen !== true || total === null || !quoteFresh;
  const appliedPromos = quote.data?.appliedPromos ?? [];
  // ORDER promos sit inside the discount line already; name them there rather than twice.
  const orderPromoNames = appliedPromos
    .filter((p) => p.effect === 'ORDER')
    .map((p) => p.name)
    .join(', ');
  const cashReceived = Number(cash.replace(/\D/g, '')) || 0;
  const change = total === null ? 0 : cashReceived - total;
  // K3.6: short only once a number has actually been typed — an empty field is a cashier
  // who has not started counting, not a cashier who is short.
  const short = total !== null && cash.length > 0 && cashReceived < total;

  // Where the money goes for QRIS/transfer. Per-depot on purpose: a franchise depot is paid
  // directly, so the QR the buyer scans has to be that depot's own.
  const payTo = useAsync<DepotPaymentPanel>(
    () => api.get(endpoints.depots.paymentInfo(depotId), true),
    [depotId],
  );
  const qrisUrl = payTo.data?.paymentQrisImageUrl ?? null;
  const bankAccount = payTo.data?.paymentBankAccountNumber ?? null;
  // A method the depot never configured cannot be taken: the buyer would have nothing to
  // scan or transfer to, and the cashier would be confirming money that never arrived.
  const methodReady: Record<CounterMethod, boolean> = {
    CASH: true,
    QRIS: !!qrisUrl,
    TRANSFER: !!bankAccount,
  };

  /**
   * K3.2: record the money for a sale that is already booked. Safe to call twice.
   *
   * Mutates `u.paymentId` as it learns it, so a throw still leaves the caller holding
   * whatever the failed attempt got as far as — that is what lets the retry skip a leg it
   * has already completed.
   *
   * Two ways initiate can be a no-op on retry, and they need different handling: it may
   * have answered (we kept the id), or it may have landed with its answer lost on the wire
   * (the server refuses the second one with PAYMENT_ALREADY_EXISTS, and the row it refuses
   * for is exactly the row to confirm). Confirming the existing row is what stops a retry
   * from booking the same money twice.
   */
  async function settle(u: Unpaid): Promise<void> {
    if (!u.paymentId) {
      try {
        const payment = await api.post<{ id: string }>(
          endpoints.payments.initiateStaff,
          {
            orderId: u.order.id,
            method: u.method,
            amount: u.order.total,
            customerId: u.order.customerId,
            // Names the drawer this money lands in. Without it the payment is depot-less and
            // the cashier's shift close would count this sale as never having happened.
            depotId,
          },
          true,
        );
        u.paymentId = payment.id;
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'PAYMENT_ALREADY_EXISTS')) throw e;
        const existing = await api.get<Page<Payment>>(
          endpoints.payments.forOrderStaff(u.order.id),
          true,
        );
        const pending = existing.items.find((p) => p.status === 'PENDING');
        // No pending row behind the refusal means the payment is already PAID — someone
        // else settled it. Rethrowing here would tell the cashier to keep trying; the
        // caller treats a clean return as settled, which is what actually happened.
        if (!pending) return;
        u.paymentId = pending.id;
      }
    }
    // Only a cash payment has change to work out. Sending cashReceived on a QRIS or
    // transfer would record a handover that never happened.
    await api.post(
      endpoints.payments.confirm(u.paymentId),
      u.method === 'CASH' ? { cashReceived: u.cashReceived } : undefined,
      true,
    );
  }

  /** The cashier pressing "coba lagi" on a sale whose money is still in their hand. */
  async function retrySettle() {
    if (!unpaid) return;
    setBusy(true);
    // A copy, so a leg that succeeded before the next one failed is not lost to React
    // reusing the same object identity.
    const attempt: Unpaid = { ...unpaid };
    try {
      await settle(attempt);
      setUnpaid(null);
      toast(t('hrFix.walkIn.paymentSettled', { order: attempt.order.orderNumber }));
    } catch (e) {
      setUnpaid(attempt);
      toast(e instanceof ApiError ? e.message : t('hrFix.walkIn.orderSavedNoPayment'), 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Everything about the current buyer and basket, back to an empty till. */
  function resetTill() {
    setQty({});
    setName('');
    setPhone('');
    // The next buyer is nobody until the cashier looks them up: a stale id would price their
    // basket, and spend a voucher, as the previous buyer.
    setBuyerId(null);
    setCash('');
    setVoucher('');
    // C11: including the address, or the next buyer's pick-up quietly becomes a delivery to
    // the previous buyer's house.
    setDeliver(false);
    setAddrName('');
    setAddrPhone('');
    setAddrLine('');
    setAddrCity('');
    setAddrNotes('');
  }

  /**
   * Back to the first product's "+" after a sale, so the next buyer starts from the top.
   * The button, not the quantity box: focusing a text field would raise the on-screen
   * keyboard over the very list the cashier is about to tap.
   */
  function focusFirstProduct() {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '[data-counter-first-product] button[aria-label="Increase quantity"]:not([disabled])',
        )
        ?.focus({ preventScroll: true });
    });
  }

  function holdBasket() {
    if (lines.length === 0) return;
    const { list, added } = addHeld(held, {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      qty: Object.fromEntries(lines.map((l) => [l.product.id, l.quantity])),
      name,
      phone,
      voucher,
      buyerId,
      delivery: {
        on: deliver,
        recipient: addrName,
        phone: addrPhone,
        line: addrLine,
        city: addrCity,
        notes: addrNotes,
      },
    });
    if (!added) return toast(t('opsFix.walkIn.heldFull', { max: MAX_HELD }), 'error');
    // Cleared only once it is safely held: a basket that could not be stored must still be
    // on the screen, not gone.
    if (!saveHeld(heldScope, list)) return toast(t('opsFix.walkIn.heldStorageFailed'), 'error');
    setHeld(list);
    resetTill();
    toast(t('opsFix.walkIn.heldSaved'));
  }

  function resumeBasket(b: HeldBasket) {
    if (lines.length > 0) return toast(t('opsFix.walkIn.heldResumeBlocked'), 'error');
    const { qty: restored, adjusted } = restoreQuantities(b, availableById);
    // Nothing left to sell: say so and keep it held, rather than load an empty basket and
    // lose the record that this buyer was waiting.
    if (Object.keys(restored).length === 0) return toast(t('opsFix.walkIn.stockShort'), 'error');
    setQty(restored);
    setName(b.name);
    setPhone(b.phone);
    setVoucher(b.voucher);
    setBuyerId(b.buyerId);
    setCash('');
    setDeliver(b.delivery?.on ?? false);
    setAddrName(b.delivery?.recipient ?? '');
    setAddrPhone(b.delivery?.phone ?? '');
    setAddrLine(b.delivery?.line ?? '');
    setAddrCity(b.delivery?.city ?? '');
    setAddrNotes(b.delivery?.notes ?? '');
    const rest = removeHeld(held, b.id);
    saveHeld(heldScope, rest);
    setHeld(rest);
    if (adjusted > 0) toast(t('opsFix.walkIn.heldAdjusted', { n: adjusted }), 'error');
  }

  function discardHeld(id: string) {
    const rest = removeHeld(held, id);
    saveHeld(heldScope, rest);
    setHeld(rest);
  }

  /** Opens the buyer's chat with the receipt already typed; the cashier presses send. */
  function sendReceiptWhatsapp() {
    if (!lastSale) return;
    const model = buildReceiptModel(
      lastSale.order,
      (key) => t(key),
      lastSale.cash,
      lastSale.method,
      outlet(),
    );
    const url = whatsappUrl(lastSale.phone, receiptToText(model));
    if (!url) return;
    if (!openExternal(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function submit() {
    if (lines.length === 0) return toast(t('opsFix.walkIn.pickProductFirst'), 'error');
    // C12: never sell against a total the server did not give. The old guard compared cash
    // to the SCREEN's sum of shelf prices, which is why an agen handing over exact money
    // was refused by the till — they were being asked for the retail number.
    if (total === null || !quoteFresh) return toast(t('opsFix.walkIn.quoteUnavailable'), 'error');
    if (method === 'CASH' && cashReceived < total) {
      return toast(t('hrFix.walkIn.cashShort'), 'error');
    }
    // The depot can change under a selected method (switcher, or the payment info loading
    // late), and confirming money into an account nobody published is worse than refusing.
    if (!methodReady[method]) {
      return toast(
        payTo.error ? t('hrFix.walkIn.payTargetUnreadable') : t('hrFix.walkIn.noPayTarget'),
        'error',
      );
    }
    // A voucher is spent from an account. Without a phone there is no account to spend from,
    // and the server would reject the sale after the buyer already agreed to the price.
    if (voucher.trim() && !phone.trim()) {
      return toast(t('hrFix.walkIn.phoneFirst'), 'error');
    }

    setBusy(true);
    // B-13: one key per till attempt, kept across failed submits. A depot on a flaky link
    // gets a retried Bayar answered with the sale it already recorded, not a second one.
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    let order: Order;
    try {
      // §I: the buyer is resolved SERVER-side now, from the phone below. This page used to
      // mint them here with a one-row Excel import, which meant every other client posting
      // this route booked the sale against the anonymous sentinel and created nobody.
      order = await api.post<Order>(
        endpoints.orders.walkIn,
        {
          depotId,
          lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          // C12: the buyer the cashier identified, so the sale prices exactly as the quote did.
          customerId: buyerId ?? undefined,
          voucherCode: voucher.trim().toUpperCase() || undefined,
          // C11: the same object the quote was priced from, so the sale cannot be a
          // different journey than the one the buyer was quoted.
          deliveryAddress: deliveryReady ? deliveryAddress : undefined,
          // #27: empty string = not asked, sent as undefined rather than a false "0 brought".
          emptiesReturned:
            galonQty > 0 && emptiesReturned.trim() !== '' ? Number(emptiesReturned) : undefined,
        },
        true,
        { 'Idempotency-Key': attemptKey.current },
      );
      attemptKey.current = '';
    } catch (e) {
      setBusy(false);
      /**
       * C14: a stock refusal used to arrive as an English sentence full of catalogue UUIDs
       * — "Insufficient stock at the fulfilling depot: <uuid> (need 5, have 2)" — printed
       * straight onto the till. It DOES name every short line, but with ids nobody at a
       * counter can read, and the basket survived alongside the stale ceiling, so trying
       * again failed identically. The only way to get fresh numbers was reloading the page,
       * which threw away the basket and the buyer's phone number.
       *
       * The refusal is now said in the cashier's language, and the stock is reloaded so the
       * steppers drop to what is really there — the retry can now succeed.
       */
      if (e instanceof ApiError && e.code === 'ORDER_INSUFFICIENT_STOCK') {
        stockReloadRef.current();
        // C6: the sale just made belongs in the till's own list.
        void recent.reload();
        return toast(t('opsFix.walkIn.stockShort'), 'error');
      }
      return toast(e instanceof ApiError ? e.message : t('opsFix.walkIn.saveError'), 'error');
    }

    // The sale is recorded and the goods are gone; a payment hiccup must not lose the
    // receipt, so the struk prints either way — and K3.2 keeps the unsettled payment on
    // this screen, where the cashier is still holding the money, instead of in a toast.
    const attempt: Unpaid = { order, method, cashReceived, paymentId: null };
    try {
      await settle(attempt);
      toast(t('opsFix.walkIn.saleSaved', { order: order.orderNumber }));
    } catch {
      setUnpaid(attempt);
      toast(t('hrFix.walkIn.orderSavedNoPayment'), 'error');
    }

    const receipt =
      method === 'CASH' ? { cashReceived, change: cashReceived - order.total } : undefined;
    setLastSale({ order, cash: receipt, method, phone: phone.trim() });
    // C14: the sale just reserved stock, so the number on screen and the stepper's ceiling
    // are both wrong until this lands. One cashier is enough to make them wrong — this is
    // not about a second till.
    stockReloadRef.current();
    // C6: the sale just made belongs in the till's own list too, not only in the card above.
    void recent.reload();
    if (!printReceipt(order, { t, locale }, receipt, method, outlet(), thermalFailed)) {
      toast(t('hrFix.walkIn.receiptBlocked'), 'error');
    }
    resetTill();
    setSalesTick((n) => n + 1);
    setBusy(false);
    focusFirstProduct();
  }

  /**
   * Undo the sale still on screen. The server does the whole reversal — refund, restock,
   * points — so this only reports it and clears the card; there is nothing to unwind here
   * if it fails, which is why the failure leaves the sale exactly where it was.
   */
  /**
   * C6: void whichever counter sale the cashier picked, not only the one still in React
   * state.
   *
   * The Batalkan button used to hang off `lastSale`, so a refresh — a reload, a second
   * cashier taking over the till, simply coming back after lunch — left the endpoint
   * reachable by no UI at all. The sale was still voidable on the server and there was no
   * way in the whole application to reach it.
   */
  async function voidSale() {
    const target = voiding;
    if (!target) return;
    setBusy(true);
    try {
      await api.post(endpoints.orders.voidWalkIn(target.id), { reason: voidReason.trim() }, true);
      toast(t('opsFix.walkIn.saleVoided', { order: target.orderNumber }));
      if (lastSale?.order.id === target.id) setLastSale(null);
      // K3.2: a voided sale has no payment to chase — the reversal already covers it.
      if (unpaid?.order.id === target.id) setUnpaid(null);
      setVoiding(null);
      setVoidReason('');
      // Stock came back, so what the counter may sell changed with it.
      await stock.reload();
      await recent.reload();
      setSalesTick((n) => n + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('opsFix.walkIn.voidError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // C14, and this line had to change FIRST or the fix below would be worse than the bug.
  //
  // `reload()` turns `loading` back on, so gating the whole till on it meant any refresh —
  // after a sale, or on the interval — blanked the screen mid-transaction: the last-sale
  // card, its Cetak ulang and its Batalkan all vanished for the length of a round trip.
  // `voidSale()` already had that blink. `loading && !data` is the form the repo already
  // uses on `dashboard/tracking`: a first load shows the skeleton, a refresh does not.
  if ((catalog.loading && !catalog.data) || (stock.loading && !stock.data)) {
    return <Skeleton className="h-64" />;
  }
  // Stock is not decoration here — it decides what may be sold, so a stock list that failed
  // to load must not render as "this depot sells nothing".
  if (catalog.error) return <ErrorState message={catalog.error} onRetry={catalog.reload} />;
  if (stock.error) return <ErrorState message={stock.error} onRetry={stock.reload} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('opsFix.walkIn.title')}
        subtitle={t('opsFix.walkIn.subtitle')}
        action={
          <Button variant="ghost" onClick={() => setPrinterOpen(true)}>
            <Printer size={18} className="mr-1" />
            {t('hrFix.printer.open')}
          </Button>
        }
      />
      <PrinterSetup open={printerOpen} onClose={() => setPrinterOpen(false)} />

      <CashierShiftBar depotId={depotId} onChange={(s) => setShift(s)} />
      {shift?.status === 'OPEN' && (
        <CounterShiftTally depotId={depotId} openedAt={shift.openedAt} refreshKey={salesTick} />
      )}

      {/*
        K3.2: an unrecorded payment is not a notification, it is a job. The toast that used
        to carry this scrolled away in seconds and left an order that is already terminal,
        appears in no outstanding-payment queue, and turns up at shift close as a cash
        difference nobody can explain. It stays here, above the till, until it is settled —
        the buyer is still at the counter and the money is still in the drawer, which is the
        best chance this payment will ever have of being recorded correctly.
      */}
      {unpaid && (
        <Card className="space-y-3 border-red-300 bg-red-50 p-4">
          <div>
            <p className="font-semibold text-[color:var(--danger)]">
              {t('hrFix.walkIn.unpaidTitle')}
            </p>
            <p className="text-sm text-[color:var(--danger)]">
              {t('hrFix.walkIn.unpaidBody', { order: unpaid.order.orderNumber })}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold tabular-nums">
              <Money amount={unpaid.order.total} />
            </p>
            <Button onClick={() => void retrySettle()} disabled={busy}>
              <MoneyIcon size={18} className="mr-1" />
              {t('hrFix.walkIn.retryPayment')}
            </Button>
          </div>
        </Card>
      )}

      {lastSale && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {t('opsFix.walkIn.lastSale')}{' '}
            <span className="font-bold">{lastSale.order.orderNumber}</span> ·{' '}
            <Money amount={lastSale.order.total} />
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                printReceipt(
                  lastSale.order,
                  { t, locale },
                  lastSale.cash,
                  lastSale.method,
                  outlet(),
                  thermalFailed,
                )
              }
            >
              <Printer size={18} className="mr-1" />
              {t('opsFix.walkIn.reprint')}
            </Button>
            {whatsappUrl(lastSale.phone, '') !== null && (
              <Button variant="ghost" onClick={sendReceiptWhatsapp}>
                {t('opsFix.walkIn.sendReceipt')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setVoiding(lastSale.order)} disabled={busy}>
              <ArrowUUpLeft size={18} className="mr-1" />
              {t('opsFix.walkIn.voidSale')}
            </Button>
          </div>
        </Card>
      )}

      {voiding && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-semibold">
              {t('opsFix.walkIn.voidConfirm', { order: voiding.orderNumber })}
            </p>
            <p className="text-sm text-muted">{t('opsFix.walkIn.voidBody')}</p>
          </div>
          <Field
            label={t('opsFix.walkIn.voidReason')}
            htmlFor="wi-void-reason"
            hint={t('opsFix.walkIn.voidReasonHint')}
          >
            <Input
              id="wi-void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t('opsFix.walkIn.voidReasonPlaceholder')}
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => void voidSale()} disabled={busy || !voidReason.trim()}>
              {t('opsFix.walkIn.voidYes')}
            </Button>
            <Button variant="ghost" onClick={() => setVoiding(null)} disabled={busy}>
              {t('opsFix.walkIn.voidNo')}
            </Button>
          </div>
        </Card>
      )}

      <CounterPromoStrip rules={livePromos.data ?? []} productName={productNameById} />
      <CounterHeldBaskets
        held={held}
        canResume={lines.length === 0}
        onResume={resumeBasket}
        onDiscard={discardHeld}
      />

      <Card className="divide-y divide-[color:var(--border)] p-0">
        {products.map((p, i) => {
          const left = availableById.get(p.id) ?? 0;
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 p-3"
              {...(i === 0 ? { 'data-counter-first-product': '' } : {})}
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted">
                  {p.sku} · <Money amount={priceById.get(p.id) ?? p.basePrice} />
                  {left <= LOW_STOCK && (
                    // Said before the stepper stops, not after: a "+" that goes dead is a
                    // cashier wondering whether the till is broken with a buyer waiting.
                    <span className="ml-1 font-semibold text-[color:var(--danger)]">
                      · {t('opsFix.walkIn.stockLeft', { n: left })}
                    </span>
                  )}
                </p>
              </div>
              <QuantityStepper
                editable
                label={`Quantity: ${p.name}`}
                value={qty[p.id] ?? 0}
                min={0}
                // Never let the counter ring up more than the depot holds: the reservation
                // would reject the whole sale after the buyer already agreed to it.
                max={left}
                onChange={(next) => setQty((q) => ({ ...q, [p.id]: next }))}
              />
            </div>
          );
        })}
        {products.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">{t('opsFix.walkIn.noProducts')}</p>
        )}
      </Card>

      {lines.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={holdBasket} disabled={busy}>
            {t('opsFix.walkIn.holdBasket')}
          </Button>
          <Button variant="ghost" onClick={() => setQty({})} disabled={busy}>
            {t('opsFix.walkIn.clearBasket')}
          </Button>
        </div>
      )}

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* htmlFor/id on every field: without it the <label> is only nearby text, so a screen
              reader announces an unnamed box and the cashier tabbing in hears nothing. */}
          <Field label={t('opsFix.walkIn.buyerName')} htmlFor="wi-name">
            <Input
              id="wi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('opsFix.walkIn.buyerNamePlaceholder')}
            />
          </Field>
          <Field
            label={t('opsFix.walkIn.buyerPhone')}
            htmlFor="wi-phone"
            hint={t('opsFix.walkIn.buyerPhoneHint')}
          >
            <Input
              id="wi-phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                // Typing a different number un-identifies the buyer: the badge and the
                // discount belong to whoever was actually looked up, not to whatever is
                // in the box now.
                setBuyerId(null);
                // …and so does a voucher picked from that buyer's list: it is theirs, and
                // the quote would refuse it for whoever the next number belongs to.
                if (offeredVouchers.some((v) => v.code === voucher)) setVoucher('');
              }}
              inputMode="tel"
              placeholder={t('opsFix.walkIn.buyerPhonePlaceholder')}
            />
          </Field>
          {/*
            C12: the one tap that may create an account, and it exists so nothing else does
            it by accident. Quoting never resolves a phone — see the quote above — so a
            number half-typed and abandoned costs nothing. The sale still resolves one when
            a sale actually happens, which is a customer who really bought something.
          */}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button
              variant="ghost"
              onClick={() => void identifyBuyer()}
              disabled={identifying || !phone.trim() || buyerId !== null}
            >
              {buyerId ? t('opsFix.walkIn.buyerIdentified') : t('opsFix.walkIn.identifyBuyer')}
            </Button>
            <span className="text-xs text-muted">{t('opsFix.walkIn.identifyHint')}</span>
          </div>
          {/* Read-only: nothing is created until the cashier taps Cek pelanggan or sells. */}
          {lookup && (
            <p className="text-xs font-semibold sm:col-span-2" role="status">
              {lookup.registered
                ? lookup.firstName
                  ? t('opsFix.walkIn.lookupRegistered', { name: lookup.firstName })
                  : t('opsFix.walkIn.lookupRegisteredNoName')
                : t('opsFix.walkIn.lookupNew')}
            </p>
          )}
          {/* So the cashier knows a first-order promo is the reason the price just moved. */}
          {buyerId && quote.data?.firstOrder && (
            <p className="flex items-center gap-2 text-xs sm:col-span-2">
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                {t('opsFix.walkIn.newCustomerBadge')}
              </span>
              <span className="text-muted">{t('opsFix.walkIn.newCustomerHint')}</span>
            </p>
          )}
        </div>

        {/*
          C11: the counter can take a delivery. The server half has been able to since #231 —
          DTO, kill switch, and a fee threaded so the quote and the sale agree — and there
          was no way for an operator to say so, which made all of it unreachable.

          Behind a toggle, and the fields only appear when it is on: the sale DTO requires
          recipient, phone, address and city, and a cashier made to type a form for every
          pick-up would go back to writing on paper. Province left with the customer address
          form: nothing downstream ever read it.
        */}
        <div className="rounded-xl border border-app p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-bold">{t('opsFix.walkIn.deliverToggle')}</span>
            <input
              type="checkbox"
              className="h-5 w-9 cursor-pointer accent-brand-600"
              checked={deliver}
              onChange={(e) => setDeliver(e.target.checked)}
            />
          </label>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">
            {t('opsFix.walkIn.deliverHint')}
          </p>

          {deliver && (
            <div className="mt-3 flex flex-col gap-2.5">
              <Input
                id="wi-addr-line"
                value={addrLine}
                onChange={(e) => setAddrLine(e.target.value)}
                placeholder={t('opsFix.walkIn.deliverAddressPlaceholder')}
              />
              {/* City alone: the counter asks for what the courier reads. Province went with
                  the customer form — no delivery, depot match or price ever consulted it. */}
              <Input
                id="wi-addr-city"
                value={addrCity}
                onChange={(e) => setAddrCity(e.target.value)}
                placeholder={t('opsFix.walkIn.deliverCityPlaceholder')}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <Input
                  id="wi-addr-name"
                  value={addrName}
                  onChange={(e) => setAddrName(e.target.value)}
                  placeholder={t('opsFix.walkIn.deliverRecipientPlaceholder')}
                />
                <Input
                  id="wi-addr-phone"
                  value={addrPhone}
                  onChange={(e) => setAddrPhone(e.target.value)}
                  placeholder={t('opsFix.walkIn.deliverPhonePlaceholder')}
                />
              </div>
              {/* Patokan: the landmark a courier actually navigates by. */}
              <Input
                id="wi-addr-notes"
                value={addrNotes}
                onChange={(e) => setAddrNotes(e.target.value)}
                placeholder={t('opsFix.walkIn.deliverNotesPlaceholder')}
              />
              {!deliveryReady && (
                // Said out loud rather than left to a disabled button with no reason: the
                // quote below is still a PICK-UP total until this is complete, and a cashier
                // reading it would otherwise quote the wrong number.
                <p className="text-[11.5px] font-semibold leading-snug text-[color:var(--danger)]">
                  {t('opsFix.walkIn.deliverIncomplete')}
                </p>
              )}
            </div>
          )}
        </div>

        {galonQty > 0 && (
          <Field
            label={t('opsFix.reports.emptiesReturnedLabel')}
            htmlFor="wi-empties"
            hint={emptiesHint}
          >
            <div className="flex items-center gap-2">
              <Input
                id="wi-empties"
                type="number"
                inputMode="numeric"
                min={0}
                max={galonQty}
                value={emptiesReturned}
                onChange={(e) => setEmptiesReturned(e.target.value)}
                placeholder="0"
              />
              <button
                type="button"
                onClick={() => setEmptiesReturned(String(galonQty))}
                className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold"
              >
                {t('opsFix.walkIn.emptiesSame')}
              </button>
            </div>
          </Field>
        )}

        <Field
          label={t('opsFix.walkIn.voucher')}
          htmlFor="wi-voucher"
          hint={t('hrFix.walkIn.voucherHint')}
        >
          <Input
            id="wi-voucher"
            value={voucher}
            onChange={(e) => setVoucher(e.target.value.toUpperCase())}
            placeholder={t('opsFix.walkIn.voucherPlaceholder')}
          />
        </Field>
        {offeredVouchers.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted">{t('opsFix.walkIn.grantedVouchers')}</p>
            <div className="flex flex-wrap gap-2">
              {offeredVouchers.map((v) => {
                const picked = voucher === v.code;
                const worth =
                  v.discountType === 'FREE_SHIPPING'
                    ? t('opsFix.walkIn.grantedVoucherFreeShipping')
                    : v.discountType === 'PERCENTAGE'
                      ? t('opsFix.walkIn.grantedVoucherPercent', { pct: v.value })
                      : formatIDR(v.value);
                return (
                  <Button
                    key={v.code}
                    type="button"
                    variant={picked ? 'primary' : 'ghost'}
                    aria-pressed={picked}
                    onClick={() => setVoucher(picked ? '' : v.code)}
                  >
                    {v.code} · {worth}
                    {v.minSpend > 0 &&
                      ` · ${t('opsFix.walkIn.grantedVoucherMin', { min: formatIDR(v.minSpend) })}`}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* C12: shelf prices are now a subtotal. The discount below is the layer only the
            server knows — tier, agen band, voucher — and it is why this screen stopped
            adding anything up itself. */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t('opsFix.walkIn.subtotal')}</span>
          <span className="tabular-nums">
            <Money amount={subtotal} />
          </span>
        </div>
        {/* Why the total is not subtotal minus discount: a price promo is already out of the
            server's subtotal, so without these rows the screen reads as a sum that does not
            add up. PRICE rows are real deductions; the rest say what else the buyer got. */}
        {appliedPromos
          .filter((p) => p.effect === 'PRICE')
          .map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex items-center justify-between text-sm">
              <span className="text-muted">{p.name}</span>
              <span className="tabular-nums text-[color:var(--success)]">
                −<Money amount={p.amountIdr} />
              </span>
            </div>
          ))}
        {appliedPromos
          .filter((p) => p.effect === 'FREE' || p.effect === 'GIFT' || p.effect === 'SHIPPING')
          .map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="flex items-center justify-between text-[12.5px] text-[color:var(--success)]"
            >
              <span>{p.name}</span>
              <span>
                {p.effect === 'SHIPPING'
                  ? t('opsFix.walkIn.promoShippingSaved', { amount: formatIDR(p.amountIdr) })
                  : t('opsFix.walkIn.promoFreeValue', { amount: formatIDR(p.amountIdr) })}
              </span>
            </div>
          ))}
        {(quote.data?.discountIdr ?? 0) > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted">
              {t('opsFix.walkIn.discount')}
              {orderPromoNames && (
                <span className="text-[11.5px]">
                  ({t('opsFix.walkIn.discountIncludes', { names: orderPromoNames })})
                </span>
              )}
              {quote.data?.agen && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                  {t('opsFix.walkIn.agenPrice')}
                </span>
              )}
            </span>
            <span className="tabular-nums text-[color:var(--success)]">
              −<Money amount={quote.data?.discountIdr ?? 0} />
            </span>
          </div>
        )}

        {(quote.data?.shippingIdr ?? 0) > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{t('opsFix.walkIn.shipping')}</span>
            <span className="tabular-nums">
              <Money amount={quote.data?.shippingIdr ?? 0} />
            </span>
          </div>
        )}

        {/* The voucher is refused HERE, before Bayar, instead of after the goods have gone. */}
        {quote.error && lines.length > 0 && (
          <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
            {quote.error}
          </p>
        )}
        {/* Unread resolved prices silently fall back to the catalog base price, so the
            depot's own override and any active rule vanish from the counter total. Not a
            refusal — the till has to keep working — but the cashier is told which number
            they are looking at. The struk still comes from `order.total`. */}
        {resolved.error && (
          <p role="alert" className="text-xs font-semibold text-[color:var(--danger)]">
            {t('opsFix.walkIn.priceUnreadable')}{' '}
            <button type="button" onClick={resolved.reload} className="underline">
              {t('opsFix.walkIn.reload')}
            </button>
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('hrFix.walkIn.paymentMethod')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['CASH', 'QRIS', 'TRANSFER'] as const).map((m) => (
              <Button
                key={m}
                type="button"
                variant={method === m ? 'primary' : 'ghost'}
                disabled={!methodReady[m]}
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
              >
                {m === 'CASH' ? t('hrFix.walkIn.cash') : m}
              </Button>
            ))}
          </div>
          {(!methodReady.QRIS || !methodReady.TRANSFER) && (
            <p className="text-xs text-muted">{t('opsFix.walkIn.methodOffHint')}</p>
          )}
        </fieldset>

        {(method === 'QRIS' || method === 'TRANSFER') && (
          // The buyer is about to type this number into their own app. Said once, large, at
          // the exact spot they are looking at, instead of leaving it to the small total row.
          <div className="text-center">
            <p className="text-xs text-muted">{t('opsFix.walkIn.payThisAmount')}</p>
            <p className="text-3xl font-extrabold tabular-nums">
              {quoteFresh && total !== null ? <Money amount={total} /> : '…'}
            </p>
          </div>
        )}

        {method === 'QRIS' && qrisUrl && (
          // A depot-uploaded URL, not a bundled asset — next/image would need the host
          // whitelisted per depot storage bucket for no gain on a print-once QR.
          <RemoteImage
            src={qrisUrl}
            alt={t('opsFix.walkIn.qrisAlt')}
            className="mx-auto max-h-64 w-auto rounded-xl border border-app"
          />
        )}
        {method === 'TRANSFER' && (
          <div className="rounded-xl border border-app p-3 text-sm">
            <p className="font-medium">{payTo.data?.paymentBankName}</p>
            <p className="font-mono text-lg font-bold">{bankAccount}</p>
            <p className="text-muted">
              {t('opsFix.walkIn.accountHolder', {
                name: payTo.data?.paymentBankAccountHolder ?? '—',
              })}
            </p>
          </div>
        )}

        {method === 'CASH' && (
          <>
            {/*
              K3.6: the same three controls the courier's COD screen already has, on the
              screen that takes more cash than it does. Sanitising as it is typed matches
              both other cash-taking screens; the notes and "uang pas" are copied from
              driver/deliveries/detail/pay, which does this job better than the till did.
            */}
            <Field
              label={t('opsFix.walkIn.cashReceived')}
              htmlFor="wi-cash"
              error={
                short ? t('opsFix.walkIn.cashShort', { amount: formatIDR(-change) }) : undefined
              }
            >
              <Input
                id="wi-cash"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  // Same gate as the button: Enter can never sell what the button would refuse.
                  if (e.key === 'Enter' && !payDisabled) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                inputMode="numeric"
                placeholder={t('opsFix.walkIn.cashPlaceholder')}
              />
            </Field>
            {total !== null && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCash(String(total))}
                  className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold"
                >
                  {t('opsFix.walkIn.exactCash')}
                </button>
                {NOTES.filter((n) => n >= total).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCash(String(n))}
                    className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold tabular-nums"
                  >
                    {n.toLocaleString('id-ID')}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                {short ? t('opsFix.walkIn.stillShort') : t('opsFix.walkIn.change')}
              </span>
              <span className={short ? 'font-bold text-[color:var(--danger)]' : 'font-bold'}>
                {/*
                  Was `Math.max(0, change)`: a short payment printed "Rp 0" in red and
                  never said how much more to ask for — the one number the cashier is
                  standing there needing. Now the shortfall is the number shown.
                */}
                <Money amount={Math.abs(change)} />
              </span>
            </div>
          </>
        )}

        {/*
          The total and Bayar stay on screen while the cashier scrolls the form above them.
          On a tablet the form is several screens long, and the button used to be at the very
          end of it. The bottom padding follows the safe-area inset (custom property first,
          env() as the fallback) so it is never under a system bar.
        */}
        <div className="surface sticky bottom-0 z-10 -mx-4 -mb-4 space-y-2 rounded-b-2xl border-t border-app p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">{t('hrFix.walkIn.total')}</span>
            <span className="text-lg font-extrabold">
              {quote.loading ? '…' : total === null ? '—' : <Money amount={total} />}
            </span>
          </div>
          <Button
            className="w-full"
            onClick={() => void submit()}
            /*
              K3.3. `shiftOpen === undefined` — the bar has not answered yet — used to leave
              this ENABLED, defended as "a slow check never blocks a queue of buyers, and the
              server refuses anyway". The server does refuse, so nothing was sold twice; what
              the cashier got was a refusal with no reason, in front of the buyer, because a
              read had not landed. Waiting and saying so is the same protection with an
              explanation attached.
            */
            // A name-based locator cannot find a button whose label changes with the state
            // being diagnosed — which is exactly what K3.3 made this label do.
            data-testid="counter-pay"
            disabled={payDisabled}
          >
            <Printer size={18} className="mr-1" />
            {shiftOpen === undefined
              ? t('opsFix.walkIn.checkingShift')
              : shiftOpen === false
                ? t('opsFix.walkIn.openShiftFirst')
                : method === 'CASH'
                  ? t('opsFix.walkIn.saveAndPrint')
                  : t('opsFix.walkIn.paidAndPrint')}
          </Button>
        </div>
      </Card>

      {/*
        C6: the till's own recent counter sales.

        Two holes closed by one list. The Batalkan button used to hang off the sale still in
        React state, so a refresh left the void endpoint reachable by NO UI at all — the
        sale was still voidable on the server and there was no way in the application to
        reach it. And nothing anywhere showed what had been voided, or why: a reversal left
        no trace a person could look at.

        Scoped by the server to the caller's own depot (`/orders/manage` does that already),
        so this is not a new way to see another depot's takings.
      */}
      <Card className="p-0">
        <div className="flex items-center justify-between gap-2 border-b border-app p-3">
          <span className="text-sm font-bold">{t('opsFix.walkIn.recentTitle')}</span>
          <span className="text-xs text-muted">{t('opsFix.walkIn.recentHint')}</span>
        </div>
        {recent.loading && !recent.data ? (
          <div className="p-3">
            <Skeleton className="h-24" />
          </div>
        ) : recent.error ? (
          <div className="p-3">
            <ErrorState message={recent.error} onRetry={recent.reload} />
          </div>
        ) : (recent.data?.items ?? []).length === 0 ? (
          <p className="p-3 text-sm text-muted">{t('opsFix.walkIn.recentEmpty')}</p>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {(recent.data?.items ?? []).map((o) => {
              const voided = o.status === 'VOIDED';
              return (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold tabular-nums">{o.orderNumber}</span>
                      {voided && (
                        <span className="rounded-full bg-[color:var(--danger-bg)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--danger)]">
                          {t('opsFix.walkIn.voidedBadge')}
                        </span>
                      )}
                    </div>
                    {/* The reason is the whole point of a void report: a reversal with no
                        account of itself is a hole in the drawer nobody can explain. */}
                    <div className="truncate text-xs text-muted">
                      {voided && o.voidReason ? o.voidReason : formatDateTime(o.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm tabular-nums ${voided ? 'line-through text-muted' : 'font-bold'}`}
                    >
                      <Money amount={o.total} />
                    </span>
                    {!voided && (
                      // Up to eight rows, plus the last-sale card, all carrying the same
                      // visible words. Without a name of its own each button announces
                      // "Batalkan penjualan" and says nothing about WHICH sale it reverses
                      // — for a screen reader that is nine identical buttons over a money
                      // mutation. The visible label stays short; only the accessible name
                      // carries the order number.
                      <Button
                        variant="ghost"
                        aria-label={t('opsFix.walkIn.voidSaleOf', { order: o.orderNumber })}
                        onClick={() => setVoiding(o)}
                        disabled={busy}
                      >
                        <ArrowUUpLeft size={16} className="mr-1" />
                        {t('opsFix.walkIn.voidSale')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function WalkInPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { scopedId, ready, error: depotError, reload: reloadDepots } = useDepot();
  // A depot-locked operator sells for their OWN depot — the switcher falls back to the first
  // depot in the network, and the server would rightly reject a sale booked against it.
  const depotId = customer?.assignedDepotId ?? scopedId;

  return (
    <RequireAuth>
      {!canRecordWalkInSale(customer?.role) ? (
        <CenterState icon={<Lock size={32} />} title={t('opsFix.walkIn.gate')}>
          {t('opsFix.walkIn.gateBody')}
        </CenterState>
      ) : !ready ? (
        <Skeleton className="h-64" />
      ) : !depotId && depotError ? (
        // The depot list failed to load. Saying "pick a depot" here would be a lie: there is
        // nothing in the picker to pick.
        <ErrorState message={depotError} onRetry={reloadDepots} />
      ) : !depotId ? (
        <CenterState icon={<MoneyIcon size={32} />} title={t('opsFix.walkIn.noDepot')}>
          {t('opsFix.walkIn.noDepotBody')}
        </CenterState>
      ) : (
        <WalkIn depotId={depotId} />
      )}
    </RequireAuth>
  );
}
