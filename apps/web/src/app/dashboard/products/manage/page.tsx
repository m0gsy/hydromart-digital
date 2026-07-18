'use client';

import { Lock, Info, Package, Plus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Page, Product } from '@/lib/types';

function ProductRow({ product }: { product: Product }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-app bg-[color:var(--surface-soft)]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Package size={22} className="text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{product.name}</p>
        <p className="text-xs text-muted">
          {/* TODO: wire per-depot stok to inventory lines (products list has no stock field). */}
          SKU {product.sku} · stok — · {product.unit}
        </p>
      </div>
      <Money amount={product.basePrice} className="shrink-0 font-semibold" />
      <Badge tone={product.active ? 'success' : 'neutral'}>{product.active ? 'Aktif' : 'Nonaktif'}</Badge>
    </Card>
  );
}

function ProductsManageBody() {
  const { selected, depots, scopedId } = useDepot();
  const products = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 100 }), true), []);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const items = products.data?.items ?? [];
  const activeCount = items.filter((p) => p.active).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Produk</h1>
            <p className="text-sm text-muted tabular-nums">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              {items.length} produk · {activeCount} aktif
            </p>
          </div>
        </div>
        {/* TODO: wire to products backend authoring (reuse endpoints.products.create). */}
        <Button>
          <Plus size={16} /> Produk baru
        </Button>
      </div>

      <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-muted">
          Harga dasar jadi acuan; aturan harga dinamis &amp; borongan menyesuaikan di atasnya.
        </p>
      </Card>

      {products.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : items.length === 0 ? (
        <CenterState title="Belum ada produk" icon={<Package size={40} weight="fill" />}>
          Katalog depot ini masih kosong.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((p) => (
            <ProductRow key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Manajer depot saja" icon={<Lock size={40} weight="fill" />}>
        Pengelolaan produk &amp; harga dasar hanya untuk manajer depot.
      </CenterState>
    );
  }
  return <ProductsManageBody />;
}

export default function ProductsManagePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
