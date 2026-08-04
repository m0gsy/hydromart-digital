'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowUUpLeft, Lock, Money as MoneyIcon, Printer } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { CashierShiftBar } from '@/components/dashboard/cashier-shift-bar';
import { QuantityStepper } from '@/components/quantity-stepper';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
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
import type { ImportResponse } from '@/components/csv-import';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { computeEffective } from '@/lib/pricing';
import { printReceipt } from '@/lib/receipt';
import { canRecordWalkInSale } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
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
function WalkIn({ depotId }: { depotId: string }) {
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cash, setCash] = useState('');
  const [voucher, setVoucher] = useState('');
  const [method, setMethod] = useState<CounterMethod>('CASH');
  const [busy, setBusy] = useState(false);
  /** Idempotency key for the sale being rung up; cleared once it is recorded. */
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
  const resolved = useAsync<ResolvedPrice[]>(
    () => (ids.length ? api.get(endpoints.inventory.prices(depotId, ids)) : Promise.resolve([])),
    [depotId, ids.join(',')],
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
  const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const cashReceived = Number(cash.replace(/\D/g, '')) || 0;
  const change = cashReceived - total;

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

  /** Resolve the buyer by phone, pre-registering them if this is their first purchase. */
  async function resolveCustomerId(): Promise<string | undefined> {
    const trimmed = phone.trim();
    if (!trimmed) return undefined;
    // The bulk-import path already does exactly this: idempotent per phone, skips numbers
    // that already have an account, and returns the customer id either way.
    const summary = await api.post<ImportResponse>(
      endpoints.depotCrm.import,
      { depotId, rows: [{ phone: trimmed, fullName: name.trim() || trimmed }] },
      true,
    );
    return summary.results[0]?.id;
  }

  async function submit() {
    if (lines.length === 0) return toast('Pilih produk dulu.', 'error');
    if (method === 'CASH' && cashReceived < total) {
      return toast('Uang tunai kurang dari total.', 'error');
    }
    // The depot can change under a selected method (switcher, or the payment info loading
    // late), and confirming money into an account nobody published is worse than refusing.
    if (!methodReady[method]) {
      return toast('Depot ini belum mengatur tujuan pembayaran untuk metode itu.', 'error');
    }
    // A voucher is spent from an account. Without a phone there is no account to spend from,
    // and the server would reject the sale after the buyer already agreed to the price.
    if (voucher.trim() && !phone.trim()) {
      return toast('Isi nomor HP pembeli dulu — voucher menempel pada akun.', 'error');
    }

    setBusy(true);
    // B-13: one key per till attempt, kept across failed submits. A depot on a flaky link
    // gets a retried Bayar answered with the sale it already recorded, not a second one.
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    let order: Order;
    try {
      const customerId = await resolveCustomerId();
      order = await api.post<Order>(
        endpoints.orders.walkIn,
        {
          depotId,
          lines: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          customerId,
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          voucherCode: voucher.trim().toUpperCase() || undefined,
        },
        true,
        { 'Idempotency-Key': attemptKey.current },
      );
      attemptKey.current = '';
    } catch (e) {
      setBusy(false);
      return toast(e instanceof ApiError ? e.message : 'Gagal menyimpan penjualan.', 'error');
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
      toast(`Penjualan ${order.orderNumber} tersimpan.`);
    } catch {
      toast('Pesanan tersimpan, pembayaran belum tercatat — selesaikan dari antrian pesanan.', 'error');
    }

    const receipt =
      method === 'CASH' ? { cashReceived, change: cashReceived - order.total } : undefined;
    setLastSale({ order, cash: receipt, method });
    if (!printReceipt(order, receipt, method)) {
      toast('Struk tidak bisa dibuka — izinkan popup, lalu tekan "Cetak ulang struk".', 'error');
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
      toast(`Penjualan ${lastSale.order.orderNumber} dibatalkan.`);
      setLastSale(null);
      setVoiding(false);
      setVoidReason('');
      // Stock came back, so what the counter may sell changed with it.
      await stock.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal membatalkan penjualan.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (catalog.loading || stock.loading) return <Skeleton className="h-64" />;
  // Stock is not decoration here — it decides what may be sold, so a stock list that failed
  // to load must not render as "this depot sells nothing".
  if (catalog.error) return <ErrorState message={catalog.error} onRetry={catalog.reload} />;
  if (stock.error) return <ErrorState message={stock.error} onRetry={stock.reload} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Penjualan di depot" subtitle="Pembeli datang langsung, bayar tunai." />

      <CashierShiftBar depotId={depotId} onChange={(s) => setShiftOpen(!!s)} />

      {lastSale && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            Penjualan terakhir <span className="font-bold">{lastSale.order.orderNumber}</span> ·{' '}
            <Money amount={lastSale.order.total} />
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => printReceipt(lastSale.order, lastSale.cash, lastSale.method)}
            >
              <Printer size={18} className="mr-1" />
              Cetak ulang struk
            </Button>
            {/* Only the sale still on screen can be voided from here. Anything older is a
                different day's drawer or someone else's shift — that goes through refunds. */}
            <Button variant="ghost" onClick={() => setVoiding(true)} disabled={busy}>
              <ArrowUUpLeft size={18} className="mr-1" />
              Batalkan penjualan
            </Button>
          </div>
        </Card>
      )}

      {lastSale && voiding && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-semibold">Batalkan {lastSale.order.orderNumber}?</p>
            <p className="text-sm text-muted">
              Uang dikembalikan ke pembeli, barang masuk stok lagi, dan poin ditarik kembali.
            </p>
          </div>
          <Field label="Alasan" htmlFor="wi-void-reason" hint="Wajib — laci akan berkurang sebesar penjualan ini.">
            <Input
              id="wi-void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Pembeli salah pilih ukuran galon"
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => void voidSale()} disabled={busy || !voidReason.trim()}>
              Ya, batalkan
            </Button>
            <Button variant="ghost" onClick={() => setVoiding(false)} disabled={busy}>
              Tidak jadi
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
            Tidak ada produk siap jual di depot ini. Isi stok dulu lewat Inventory.
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* htmlFor/id on every field: without it the <label> is only nearby text, so a screen
              reader announces an unnamed box and the cashier tabbing in hears nothing. */}
          <Field label="Nama pembeli (opsional)" htmlFor="wi-name">
            <Input
              id="wi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Budi"
            />
          </Field>
          <Field
            label="Nomor HP (opsional)"
            htmlFor="wi-phone"
            hint="Diisi = pembeli dapat poin dan masuk daftar pelanggan depot."
          >
            <Input
              id="wi-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="08123456789"
            />
          </Field>
        </div>

        <Field
          label="Kode voucher (opsional)"
          htmlFor="wi-voucher"
          hint="Voucher milik pembeli. Butuh nomor HP; potongan dihitung server saat disimpan."
        >
          <Input
            id="wi-voucher"
            value={voucher}
            onChange={(e) => setVoucher(e.target.value.toUpperCase())}
            placeholder="HEMAT10"
          />
        </Field>

        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">Total</span>
          <span className="text-lg font-extrabold">
            <Money amount={total} />
          </span>
        </div>
        {(voucher.trim() || phone.trim()) && (
          // The counter shows the shelf price. Tier and voucher are priced by the server
          // against the buyer's own account, so promising a number here could be a lie.
          <p className="text-xs text-muted">
            Potongan tier/voucher dihitung saat disimpan dan tercetak di struk.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Metode pembayaran</legend>
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
                {m === 'CASH' ? 'Tunai' : m}
              </Button>
            ))}
          </div>
          {(!methodReady.QRIS || !methodReady.TRANSFER) && (
            <p className="text-xs text-muted">
              Metode yang mati belum diatur depot — isi QRIS/rekening di halaman Depot.
            </p>
          )}
        </fieldset>

        {method === 'QRIS' && qrisUrl && (
          // A depot-uploaded URL, not a bundled asset — next/image would need the host
          // whitelisted per depot storage bucket for no gain on a print-once QR.
          <RemoteImage
            src={qrisUrl}
            alt="Kode QRIS depot untuk dipindai pembeli"
            className="mx-auto max-h-64 w-auto rounded-xl border border-app"
          />
        )}
        {method === 'TRANSFER' && (
          <div className="rounded-xl border border-app p-3 text-sm">
            <p className="font-medium">{payTo.data?.paymentBankName}</p>
            <p className="font-mono text-lg font-bold">{bankAccount}</p>
            <p className="text-muted">a.n. {payTo.data?.paymentBankAccountHolder}</p>
          </div>
        )}

        {method === 'CASH' && (
          <Field label="Uang tunai diterima" htmlFor="wi-cash">
            <Input
              id="wi-cash"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              inputMode="numeric"
              placeholder="50000"
            />
          </Field>
        )}
        {method === 'CASH' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Kembalian</span>
            <span className={change < 0 ? 'font-bold text-red-600' : 'font-bold'}>
              <Money amount={Math.max(0, change)} />
            </span>
          </div>
        )}

        <Button
          className="w-full"
          onClick={() => void submit()}
          disabled={busy || lines.length === 0 || shiftOpen === false}
        >
          <Printer size={18} className="mr-1" />
          {shiftOpen === false
            ? 'Buka shift dulu'
            : method === 'CASH'
              ? 'Simpan & cetak struk'
              : 'Pembayaran diterima & cetak struk'}
        </Button>
      </Card>
    </div>
  );
}

export default function WalkInPage() {
  const { customer } = useAuth();
  const { scopedId, ready, error: depotError, reload: reloadDepots } = useDepot();
  // A depot-locked operator sells for their OWN depot — the switcher falls back to the first
  // depot in the network, and the server would rightly reject a sale booked against it.
  const depotId = customer?.assignedDepotId ?? scopedId;

  return (
    <RequireAuth>
      {!canRecordWalkInSale(customer?.role) ? (
        <CenterState icon={<Lock size={32} />} title="Akses terbatas">
          Hanya operator dan kepala depot yang bisa mencatat penjualan di konter.
        </CenterState>
      ) : !ready ? (
        <Skeleton className="h-64" />
      ) : !depotId && depotError ? (
        // The depot list failed to load. Saying "pick a depot" here would be a lie: there is
        // nothing in the picker to pick.
        <ErrorState message={depotError} onRetry={reloadDepots} />
      ) : !depotId ? (
        <CenterState icon={<MoneyIcon size={32} />} title="Belum ada depot">
          Pilih depot dulu dari pemilih depot.
        </CenterState>
      ) : (
        <WalkIn depotId={depotId} />
      )}
    </RequireAuth>
  );
}
