'use client';

import { Sheet } from '@/components/overlay';
import { Badge, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, InventoryItem } from '@/lib/types';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * Depot drill-down (6a): profile + config + live stock summary. ponytail: "recent
 * orders" is omitted — order-service exposes no depot-scoped order feed (manage
 * filters by status only); add one to list a depot's latest orders here.
 */
export function DepotDetail({ depot, onClose }: { depot: DepotAdmin; onClose: () => void }) {
  const stock = useAsync<InventoryItem[]>(() => api.get(endpoints.inventory.lines(depot.id), true), [depot.id]);
  const lines = stock.data ?? [];
  const lowCount = lines.filter((l) => l.lowStock).length;
  const holidays = depot.holidays?.length ?? 0;

  return (
    <Sheet open onClose={onClose} title={depot.name}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {depot.code} · {depot.ownershipType}
          </p>
          <Badge tone={depot.active ? 'success' : 'neutral'}>{depot.active ? 'Aktif' : 'Nonaktif'}</Badge>
        </div>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Profil</h3>
          <dl className="rounded-2xl border border-app px-3">
            <Row label="Alamat">
              {depot.address}, {depot.city}, {depot.province}
            </Row>
            <Row label="Koordinat">
              {depot.lat}, {depot.lng}
            </Row>
          </dl>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Konfigurasi</h3>
          <dl className="rounded-2xl border border-app px-3">
            <Row label="Radius layanan">{depot.serviceRadiusKm} km</Row>
            <Row label="Ongkir">
              <Money amount={depot.deliveryFee} />
            </Row>
            <Row label="Min. order">
              {depot.minOrderAmount == null ? '—' : <Money amount={depot.minOrderAmount} />}
            </Row>
            <Row label="Hari libur">{holidays} tanggal</Row>
          </dl>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">Ringkasan stok</h3>
          {stock.loading ? (
            <Skeleton className="h-16 w-full" />
          ) : stock.error ? (
            <ErrorState message={stock.error} onRetry={stock.reload} />
          ) : (
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-app p-3 text-center">
                <dt className="text-xs text-muted">Lini stok</dt>
                <dd className="text-lg font-bold tabular-nums">{lines.length}</dd>
              </div>
              <div className="rounded-2xl border border-app p-3 text-center">
                <dt className="text-xs text-muted">Stok menipis</dt>
                <dd className={`text-lg font-bold tabular-nums ${lowCount > 0 ? 'text-amber-700' : ''}`}>
                  {lowCount}
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </Sheet>
  );
}
