'use client';

import { useState } from 'react';
import { ImageSquare, Lock, Package, Plus, Spinner as SpinnerIcon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { compressImage } from '@/lib/image';
import { useAsync } from '@/lib/use-async';
import type { Category, Page, Product } from '@/lib/types';

const ADMIN_ROLES = ['DEPOT_MANAGER', 'SUPER_ADMIN'];
const SELECT_CLASS =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand-600';

interface ProductForm {
  name: string;
  sku: string;
  unit: string;
  basePrice: string;
  categoryId: string;
  description: string;
  imageUrl: string;
}

const EMPTY: ProductForm = {
  name: '',
  sku: '',
  unit: '',
  basePrice: '',
  categoryId: '',
  description: '',
  imageUrl: '',
};

function toForm(p: Product): ProductForm {
  return {
    name: p.name,
    sku: p.sku,
    unit: p.unit,
    basePrice: String(p.basePrice),
    categoryId: p.categoryId ?? '',
    description: p.description ?? '',
    imageUrl: p.imageUrl ?? '',
  };
}

function ProductAdmin() {
  const products = useAsync<Page<Product>>(
    () => api.get(endpoints.products.browse({ limit: 100 }), true),
    [],
  );
  const categories = useAsync<Category[]>(() => api.get(endpoints.products.categories), []);

  const [editing, setEditing] = useState<string | null>(null); // product id, or 'new', or null
  const [form, setForm] = useState<ProductForm>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof ProductForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY);
    setEditing('new');
    setError(null);
  };
  const openEdit = (p: Product) => {
    setForm(toForm(p));
    setEditing(p.id);
    setError(null);
  };
  const close = () => setEditing(null);

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const blob = await compressImage(file);
      const { url } = await uploadFile(
        endpoints.products.uploadImage,
        new File([blob], 'product.jpg', { type: blob.type || 'image/jpeg' }),
      );
      set('imageUrl', url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal upload gambar.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setError(null);
    if (!form.name.trim() || !form.sku.trim() || !form.unit.trim()) {
      return setError('Nama, SKU, dan satuan wajib diisi.');
    }
    const price = Number(form.basePrice);
    if (!(price > 0)) return setError('Harga dasar harus lebih dari 0.');

    const body = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      unit: form.unit.trim(),
      basePrice: price,
      categoryId: form.categoryId || undefined,
      description: form.description.trim() || undefined,
      imageUrl: form.imageUrl || undefined,
    };
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post(endpoints.products.create, body, true);
      } else if (editing) {
        await api.patch(endpoints.products.update(editing), body, true);
      }
      close();
      products.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan produk.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id: string) => {
    setError(null);
    try {
      await api.del(endpoints.products.remove(id), true);
      products.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menonaktifkan produk.');
    }
  };

  const items = products.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold">Katalog produk</h1>
        </div>
        {editing === null && (
          <Button onClick={openNew}>
            <Plus size={16} /> Produk baru
          </Button>
        )}
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {editing !== null && (
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">{editing === 'new' ? 'Produk baru' : 'Ubah produk'}</h2>

          <div className="flex items-start gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-app bg-[color:var(--surface)]">
              {form.imageUrl ? (
                <img src={form.imageUrl} alt="Gambar produk" className="h-full w-full object-cover" />
              ) : (
                <ImageSquare size={28} className="text-muted" />
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-app px-4 py-2.5 text-sm text-muted hover:border-brand-500">
              {uploading ? <SpinnerIcon size={16} className="animate-spin" /> : <ImageSquare size={16} />}
              {uploading ? 'Mengunggah…' : form.imageUrl ? 'Ganti gambar' : 'Unggah gambar'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => onPickImage(e.target.files?.[0])}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={150} />
            </Field>
            <Field label="SKU">
              <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} maxLength={60} />
            </Field>
            <Field label="Satuan">
              <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="cth. Galon 19L" maxLength={50} />
            </Field>
            <Field label="Harga dasar (IDR)">
              <Input type="number" min={1} value={form.basePrice} onChange={(e) => set('basePrice', e.target.value)} />
            </Field>
            <Field label="Kategori">
              <select className={SELECT_CLASS} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">— Tanpa kategori —</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Deskripsi (opsional)">
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />
          </Field>

          <div className="flex gap-2">
            <Button onClick={save} loading={saving}>
              Simpan
            </Button>
            <Button variant="secondary" onClick={close}>
              Batal
            </Button>
          </div>
        </Card>
      )}

      {products.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : items.length === 0 ? (
        <CenterState icon={<Package size={32} />} title="Belum ada produk" />
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <Card key={p.id} className="flex items-center gap-3 p-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-app bg-[color:var(--surface)]">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <ImageSquare size={20} className="text-muted" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-xs text-muted">
                  {p.sku} · {p.unit}
                </p>
              </div>
              <Money amount={p.basePrice} className="font-semibold" />
              <div className="flex gap-1.5">
                <Button variant="secondary" onClick={() => openEdit(p)}>
                  Ubah
                </Button>
                <Button variant="secondary" onClick={() => deactivate(p.id)}>
                  Nonaktifkan
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Admin catalog management: create/edit products with image upload. */
export default function ProductsAdminPage() {
  const { customer } = useAuth();

  return (
    <RequireAuth>
      {customer && ADMIN_ROLES.includes(customer.role) ? (
        <ProductAdmin />
      ) : (
        <CenterState icon={<Lock size={32} />} title="Akses terbatas">
          Halaman ini khusus manajer depot / admin.
        </CenterState>
      )}
    </RequireAuth>
  );
}
