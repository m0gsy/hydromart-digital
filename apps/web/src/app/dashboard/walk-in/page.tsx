'use client';

import { useMemo, useState } from 'react';
import { Lock, Money as MoneyIcon, Printer } from '@phosphor-icons/react';

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
import type { InventoryItem, Order, Page, Product, ResolvedPrice } from '@/lib/types';

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
  const [busy, setBusy] = useState(false);
  // The sale just recorded, kept so its receipt can be printed again — the print window is a
  // popup and a blocked one used to lose the struk with the form already cleared.
  const [lastSale, setLastSale] = useState<{
    order: Order;
    cash: { cashReceived: number; change: number };
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
    if (cashReceived < total) return toast('Uang tunai kurang dari total.', 'error');

    setBusy(true);
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
        },
        true,
      );
    } catch (e) {
      setBusy(false);
      return toast(e instanceof ApiError ? e.message : 'Gagal menyimpan penjualan.', 'error');
    }

    // The sale is recorded and the goods are gone; a payment hiccup must not lose the
    // receipt, so the struk prints either way and the cashier settles from the order queue.
    try {
      const payment = await api.post<{ id: string }>(
        endpoints.payments.initiateStaff,
        { orderId: order.id, method: 'CASH', amount: order.total, customerId: order.customerId },
        true,
      );
      await api.post(endpoints.payments.confirm(payment.id), { cashReceived }, true);
      toast(`Penjualan ${order.orderNumber} tersimpan.`);
    } catch {
      toast('Pesanan tersimpan, pembayaran belum tercatat — selesaikan dari antrian pesanan.', 'error');
    }

    const receipt = { cashReceived, change: cashReceived - order.total };
    setLastSale({ order, cash: receipt });
    if (!printReceipt(order, receipt)) {
      toast('Struk tidak bisa dibuka — izinkan popup, lalu tekan "Cetak ulang struk".', 'error');
    }
    setQty({});
    setName('');
    setPhone('');
    setCash('');
    setBusy(false);
  }

  if (catalog.loading || stock.loading) return <Skeleton className="h-64" />;
  // Stock is not decoration here — it decides what may be sold, so a stock list that failed
  // to load must not render as "this depot sells nothing".
  if (catalog.error) return <ErrorState message={catalog.error} onRetry={catalog.reload} />;
  if (stock.error) return <ErrorState message={stock.error} onRetry={stock.reload} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Penjualan di depot" subtitle="Pembeli datang langsung, bayar tunai." />

      {lastSale && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            Penjualan terakhir <span className="font-bold">{lastSale.order.orderNumber}</span> ·{' '}
            <Money amount={lastSale.order.total} />
          </p>
          <Button variant="ghost" onClick={() => printReceipt(lastSale.order, lastSale.cash)}>
            <Printer size={18} className="mr-1" />
            Cetak ulang struk
          </Button>
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

        <div className="flex items-center justify-between text-sm">
          <span className="font-bold">Total</span>
          <span className="text-lg font-extrabold">
            <Money amount={total} />
          </span>
        </div>

        <Field label="Uang tunai diterima" htmlFor="wi-cash">
          <Input
            id="wi-cash"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            inputMode="numeric"
            placeholder="50000"
          />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Kembalian</span>
          <span className={change < 0 ? 'font-bold text-red-600' : 'font-bold'}>
            <Money amount={Math.max(0, change)} />
          </span>
        </div>

        <Button className="w-full" onClick={() => void submit()} disabled={busy || lines.length === 0}>
          <Printer size={18} className="mr-1" />
          Simpan &amp; cetak struk
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
