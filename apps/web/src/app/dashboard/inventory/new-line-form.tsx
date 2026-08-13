'use client';

import { useState } from 'react';

import { Button, Card, Field, Input, LoadError } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { InventoryItem, InventoryItemType, Page, Product } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

const RAW_TYPES: { value: InventoryItemType; label: string }[] = [
  { value: 'AIR', label: 'Air (bahan baku)' },
  { value: 'GALON', label: 'Galon kosong' },
  { value: 'TUTUP', label: 'Tutup galon' },
  { value: 'SEGEL', label: 'Segel' },
];

/**
 * Opens a stock line for one depot. Before this the only way to create one was a CSV
 * carrying a raw product UUID, so a new catalog product silently never reached a depot's
 * ledger — and sold with no stock control at all.
 *
 * A PRODUK line is picked from the catalog: the id comes from the dropdown, and
 * depot-service overwrites label/unit with the catalog's own, so the two can never drift.
 * Products that already have a line here are left out — the API would reject them as
 * duplicates anyway.
 */
export function NewLineForm({
  depotId,
  existing,
  preselectProductId,
  onDone,
  onCancel,
}: {
  depotId: string;
  existing: InventoryItem[];
  preselectProductId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const catalog = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 100 })), []);
  const [itemType, setItemType] = useState<InventoryItemType>('PRODUK');
  const [productId, setProductId] = useState(preselectProductId ?? '');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('unit');
  const [quantity, setQuantity] = useState('0');
  const [minimumStock, setMinimumStock] = useState('0');
  const [sellPrice, setSellPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = new Set(existing.map((i) => i.productId).filter(Boolean));
  const options = (catalog.data?.items ?? []).filter(
    (p) => !taken.has(p.id) || p.id === preselectProductId,
  );
  const isProduk = itemType === 'PRODUK';

  async function submit() {
    if (isProduk && !productId) {
      setError('Pilih produk dari katalog dulu.');
      return;
    }
    if (!isProduk && !label.trim()) {
      setError('Isi nama barangnya.');
      return;
    }
    const qty = Number(quantity || 0);
    const min = Number(minimumStock || 0);
    if (!Number.isInteger(qty) || qty < 0 || !Number.isInteger(min) || min < 0) {
      setError('Jumlah dan stok minimum harus angka bulat 0 atau lebih.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const picked = options.find((p) => p.id === productId);
      await api.post(
        endpoints.inventory.create(depotId),
        {
          itemType,
          // Sent for a PRODUK line only: depot-service refuses a raw line that carries one.
          ...(isProduk ? { productId } : {}),
          // depot-service replaces both from the catalog for a PRODUK line; these are
          // what it falls back to when product-service cannot be reached.
          label: isProduk ? (picked?.name ?? 'Produk') : label.trim(),
          unit: isProduk ? (picked?.unit ?? 'unit') : unit.trim() || 'unit',
          quantity: qty,
          minimumStock: min,
          ...(isProduk && sellPrice.trim() !== '' ? { sellPrice: Number(sellPrice) } : {}),
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat baris stok.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">Tambah baris stok</h2>
        <p className="text-sm text-muted">
          Baris stok menghubungkan produk katalog dengan depot ini. Tanpa baris, produk tetap
          bisa dipesan tapi stoknya tidak pernah berkurang.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Jenis">
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as InventoryItemType)}
            className={inputClass}
          >
            <option value="PRODUK">Produk jadi (dari katalog)</option>
            {RAW_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        {isProduk ? (
          <Field label="Produk">
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className={inputClass}
              disabled={catalog.loading}
            >
              <option value="">
                {catalog.loading ? 'Memuat katalog…' : 'Pilih produk…'}
              </option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sku}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Nama barang">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Galon 19L" />
            </Field>
            <Field label="Satuan">
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit / liter / pcs" />
            </Field>
          </>
        )}

        <Field label="Stok awal">
          <Input
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Stok minimum (0 = tanpa alert)">
          <Input
            inputMode="numeric"
            value={minimumStock}
            onChange={(e) => setMinimumStock(e.target.value)}
            placeholder="0"
          />
        </Field>
        {isProduk && (
          <Field label="Harga khusus depot (opsional)">
            <Input
              inputMode="numeric"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="kosong = harga katalog"
            />
          </Field>
        )}
      </div>

      {/* An unread catalog leaves `options` empty, and the line below would then claim every
          product already has a stock row — the one reading that stops somebody adding one. */}
      {isProduk && catalog.error && <LoadError onRetry={catalog.reload} />}
      {isProduk && !catalog.loading && !catalog.error && options.length === 0 && (
        <p className="text-sm text-muted">
          Semua produk katalog sudah punya baris stok di depot ini.
        </p>
      )}
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan baris
        </Button>
      </div>
    </Card>
  );
}
