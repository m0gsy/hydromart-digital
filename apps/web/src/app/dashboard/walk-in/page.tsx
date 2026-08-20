'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUUpLeft, Lock, Money as MoneyIcon, Printer } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { CashierShiftBar } from '@/components/dashboard/cashier-shift-bar';
import { QuantityStepper } from '@/components/quantity-stepper';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
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
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { computeEffective } from '@/lib/pricing';
import { printReceipt } from '@/lib/receipt';
import { canRecordWalkInSale } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
  CounterQuote,
  DepotPaymentPanel,
  InventoryItem,
  Order,
  Page,
  Product,
  ResolvedPrice,
} from '@/lib/types';

/** What a buyer can settle with at the counter. All three are confirmed by the cashier. */
type CounterMethod = 'CASH' | 'QRIS' | 'TRANSFER';

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

function WalkIn({ depotId }: { depotId: string }) {
  const { t, locale } = useT();
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cash, setCash] = useState('');
  const [voucher, setVoucher] = useState('');
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
  const [shiftOpen, setShiftOpen] = useState<boolean | undefined>(undefined);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  // The sale just recorded, kept so its receipt can be printed again — the print window is a
  // popup and a blocked one used to lose the struk with the form already cleared.
  const [lastSale, setLastSale] = useState<{
    order: Order;
    cash?: { cashReceived: number; change: number };
    method: CounterMethod;
  } | null>(null);

  const catalog = useAsync<Page<Product>>(
    () => api.get(endpoints.products.browse({ limit: 100 })),
    [depotId],
  );
  // What this depot can actually hand over. The counter used to list the whole catalogue,
  // so a cashier could ring up a product this depot never stocks and only find out when the
  // reservation bounced — with the buyer already standing there.
  const stock = useAsync<InventoryItem[]>(
    () => api.get(endpoints.inventory.lines(depotId), true),
    [depotId],
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
  const stockReloadRef = useRef(stock.reload);
  stockReloadRef.current = stock.reload;
  useEffect(() => {
    const t = setInterval(() => stockReloadRef.current(), STOCK_REFRESH_MS);
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
    () => (catalog.data?.items ?? []).filter((p) => (availableById.get(p.id) ?? 0) > 0),
    [catalog.data, availableById],
  );
  const ids = products.map((p) => p.id);
  // Quantities go with the ids so a wholesale band is priced for what is actually being sold
  // (design 16b). Without them the till quoted the list price for a 20-galon sale the order
  // then stored at the bulk price — the cashier collected Rp60.000 too much.
  const askQty = products.map((p) => qty[p.id] ?? 0);
  const resolved = useAsync<ResolvedPrice[]>(
    () =>
      ids.length
        ? api.get(endpoints.inventory.prices(depotId, ids, askQty))
        : Promise.resolve([]),
    [depotId, ids.join(','), askQty.join(',')],
  );

  // Prices shown here are the same ones checkout would charge: depot override + active rule.
  const priceById = useMemo(() => {
    const byId = new Map((resolved.data ?? []).map((r) => [r.productId, r]));
    return new Map(products.map((p) => [p.id, computeEffective(p.basePrice, byId.get(p.id)).effective]));
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
            },
            true,
          ),
    [depotId, lines.map((l) => `${l.product.id}:${l.quantity}`).join(','), buyerId, voucher.trim()],
  );

  // No silent fall back to shelf prices: a total the server did not agree to is exactly the
  // bug this replaces. The Bayar button is disabled instead, and the reason is on screen.
  const total = quote.data?.totalIdr ?? null;
  const cashReceived = Number(cash.replace(/\D/g, '')) || 0;
  const change = total === null ? 0 : cashReceived - total;

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

  async function submit() {
    if (lines.length === 0) return toast(t('opsFix.walkIn.pickProductFirst'), 'error');
    // C12: never sell against a total the server did not give. The old guard compared cash
    // to the SCREEN's sum of shelf prices, which is why an agen handing over exact money
    // was refused by the till — they were being asked for the retail number.
    if (total === null) return toast(t('opsFix.walkIn.quoteUnavailable'), 'error');
    if (method === 'CASH' && cashReceived < total) {
      return toast(t('hrFix.walkIn.cashShort'), 'error');
    }
    // The depot can change under a selected method (switcher, or the payment info loading
    // late), and confirming money into an account nobody published is worse than refusing.
    if (!methodReady[method]) {
      return toast(
        payTo.error
          ? t('hrFix.walkIn.payTargetUnreadable')
          : t('hrFix.walkIn.noPayTarget'),
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
        return toast(t('opsFix.walkIn.stockShort'), 'error');
      }
      return toast(e instanceof ApiError ? e.message : t('opsFix.walkIn.saveError'), 'error');
    }

    // The sale is recorded and the goods are gone; a payment hiccup must not lose the
    // receipt, so the struk prints either way and the cashier settles from the order queue.
    try {
      const payment = await api.post<{ id: string }>(
        endpoints.payments.initiateStaff,
        {
          orderId: order.id,
          method,
          amount: order.total,
          customerId: order.customerId,
          // Names the drawer this money lands in. Without it the payment is depot-less and
          // the cashier's shift close would count this sale as never having happened.
          depotId,
        },
        true,
      );
      // Only a cash payment has change to work out. Sending cashReceived on a QRIS or
      // transfer would record a handover that never happened.
      await api.post(
        endpoints.payments.confirm(payment.id),
        method === 'CASH' ? { cashReceived } : undefined,
        true,
      );
      toast(t('opsFix.walkIn.saleSaved', { order: order.orderNumber }));
    } catch {
      toast(t('hrFix.walkIn.orderSavedNoPayment'), 'error');
    }

    const receipt =
      method === 'CASH' ? { cashReceived, change: cashReceived - order.total } : undefined;
    setLastSale({ order, cash: receipt, method });
    // C14: the sale just reserved stock, so the number on screen and the stepper's ceiling
    // are both wrong until this lands. One cashier is enough to make them wrong — this is
    // not about a second till.
    stockReloadRef.current();
    if (!printReceipt(order, { t, locale }, receipt, method)) {
      toast(t('hrFix.walkIn.receiptBlocked'), 'error');
    }
    setQty({});
    setName('');
    setPhone('');
    setCash('');
    setVoucher('');
    setBusy(false);
  }

  /**
   * Undo the sale still on screen. The server does the whole reversal — refund, restock,
   * points — so this only reports it and clears the card; there is nothing to unwind here
   * if it fails, which is why the failure leaves the sale exactly where it was.
   */
  async function voidSale() {
    if (!lastSale) return;
    setBusy(true);
    try {
      await api.post(endpoints.orders.voidWalkIn(lastSale.order.id), { reason: voidReason.trim() }, true);
      toast(t('opsFix.walkIn.saleVoided', { order: lastSale.order.orderNumber }));
      setLastSale(null);
      setVoiding(false);
      setVoidReason('');
      // Stock came back, so what the counter may sell changed with it.
      await stock.reload();
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
      <SectionHeader title={t('opsFix.walkIn.title')} subtitle={t('opsFix.walkIn.subtitle')} />

      <CashierShiftBar depotId={depotId} onChange={(s) => setShiftOpen(!!s)} />

      {lastSale && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {t('opsFix.walkIn.lastSale')} <span className="font-bold">{lastSale.order.orderNumber}</span> ·{' '}
            <Money amount={lastSale.order.total} />
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => printReceipt(lastSale.order, { t, locale }, lastSale.cash, lastSale.method)}
            >
              <Printer size={18} className="mr-1" />
              {t('opsFix.walkIn.reprint')}
            </Button>
            {/* Only the sale still on screen can be voided from here. Anything older is a
                different day's drawer or someone else's shift — that goes through refunds. */}
            <Button variant="ghost" onClick={() => setVoiding(true)} disabled={busy}>
              <ArrowUUpLeft size={18} className="mr-1" />
              {t('opsFix.walkIn.voidSale')}
            </Button>
          </div>
        </Card>
      )}

      {lastSale && voiding && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-semibold">
              {t('opsFix.walkIn.voidConfirm', { order: lastSale.order.orderNumber })}
            </p>
            <p className="text-sm text-muted">
              {t('opsFix.walkIn.voidBody')}
            </p>
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
            <Button variant="ghost" onClick={() => setVoiding(false)} disabled={busy}>
              {t('opsFix.walkIn.voidNo')}
            </Button>
          </div>
        </Card>
      )}

      <Card className="divide-y divide-[color:var(--border)] p-0">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted">
                {p.sku} · <Money amount={priceById.get(p.id) ?? p.basePrice} />
              </p>
            </div>
            <QuantityStepper
              value={qty[p.id] ?? 0}
              min={0}
              // Never let the counter ring up more than the depot holds: the reservation
              // would reject the whole sale after the buyer already agreed to it.
              max={availableById.get(p.id) ?? 0}
              onChange={(next) => setQty((q) => ({ ...q, [p.id]: next }))}
            />
          </div>
        ))}
        {products.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">
            {t('opsFix.walkIn.noProducts')}
          </p>
        )}
      </Card>

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
        </div>

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

        {/* C12: shelf prices are now a subtotal. The discount below is the layer only the
            server knows — tier, agen band, voucher — and it is why this screen stopped
            adding anything up itself. */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t('opsFix.walkIn.subtotal')}</span>
          <span className="tabular-nums"><Money amount={subtotal} /></span>
        </div>
        {(quote.data?.discountIdr ?? 0) > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted">
              {t('opsFix.walkIn.discount')}
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

        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">{t('hrFix.walkIn.total')}</span>
          <span className="text-lg font-extrabold">
            {quote.loading ? '…' : total === null ? '—' : <Money amount={total} />}
          </span>
        </div>
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
          <p className="text-xs font-semibold text-red-600">
            Harga khusus depot tidak terbaca — total memakai harga dasar katalog.{' '}
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
            <p className="text-xs text-muted">
              {t('opsFix.walkIn.methodOffHint')}
            </p>
          )}
        </fieldset>

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
          <Field label={t('opsFix.walkIn.cashReceived')} htmlFor="wi-cash">
            <Input
              id="wi-cash"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              inputMode="numeric"
              placeholder={t('opsFix.walkIn.cashPlaceholder')}
            />
          </Field>
        )}
        {method === 'CASH' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">{t('opsFix.walkIn.change')}</span>
            <span className={change < 0 ? 'font-bold text-red-600' : 'font-bold'}>
              <Money amount={Math.max(0, change)} />
            </span>
          </div>
        )}

        <Button
          className="w-full"
          onClick={() => void submit()}
          disabled={busy || lines.length === 0 || shiftOpen === false || total === null}
        >
          <Printer size={18} className="mr-1" />
          {shiftOpen === false
            ? t('opsFix.walkIn.openShiftFirst')
            : method === 'CASH'
              ? t('opsFix.walkIn.saveAndPrint')
              : t('opsFix.walkIn.paidAndPrint')}
        </Button>
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
