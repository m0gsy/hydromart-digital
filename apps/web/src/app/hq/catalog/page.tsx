'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Package } from '@phosphor-icons/react';

import { Badge, Button, Card, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { slugify } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Category, Page, Product } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

interface ProductForm {
  name: string;
  sku: string;
  unit: string;
  basePrice: string;
  categoryId: string;
  description: string;
  active: boolean;
}

function formFrom(p: Product): ProductForm {
  return {
    name: p.name, sku: p.sku, unit: p.unit, basePrice: String(p.basePrice),
    categoryId: p.categoryId ?? '', description: p.description ?? '', active: p.active,
  };
}

const EMPTY: ProductForm = { name: '', sku: '', unit: 'pcs', basePrice: '', categoryId: '', description: '', active: true };

function ProductEditor({
  product,
  categories,
  onDone,
  onCancel,
}: {
  product: Product | null;
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<ProductForm>(product ? formFrom(product) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ProductForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.name.trim()) return setError(t('hq.catalog.needName'));
    const price = Number(form.basePrice);
    if (!Number.isFinite(price) || price < 0) return setError(t('hq.catalog.needPrice'));
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        unit: form.unit.trim() || 'pcs',
        basePrice: price,
        categoryId: form.categoryId || null,
        description: form.description.trim() || null,
      };
      if (product) {
        payload.active = form.active;
        await api.patch(endpoints.products.update(product.id), payload, true);
      } else {
        await api.post(endpoints.products.create, payload, true);
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.catalog.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{product ? t('hq.catalog.editorEdit') : t('hq.catalog.editorNew')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('hq.catalog.fields.name')}>
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <Field label={t('hq.catalog.fields.sku')}>
          <Input value={form.sku} onChange={set('sku')} />
        </Field>
        <Field label={t('hq.catalog.fields.price')}>
          <Input inputMode="numeric" value={form.basePrice} onChange={set('basePrice')} placeholder="20000" />
        </Field>
        <Field label={t('hq.catalog.fields.unit')}>
          <Input value={form.unit} onChange={set('unit')} placeholder="galon / dus / pcs" />
        </Field>
        <Field label={t('hq.catalog.fields.category')}>
          <select value={form.categoryId} onChange={set('categoryId')} className={inputClass}>
            <option value="">{t('hq.catalog.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {product && (
          <Field label={t('hq.catalog.fields.active')}>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              {t('hq.catalog.fields.active')}
            </label>
          </Field>
        )}
      </div>
      <Field label={t('hq.catalog.fields.description')}>
        <textarea rows={2} value={form.description} onChange={set('description')} className={inputClass} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} loading={busy}>
          {product ? t('hq.catalog.save') : t('hq.catalog.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('hq.catalog.cancel')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Category master list. The product editor above only PICKS from this list; until now
 * nothing in any console could add to it, so a new category meant calling the API by hand.
 * Same MANAGER/SUPER_ADMIN roles as product create, so no extra gating is needed here.
 */
function CategoryManager({ onChange }: { onChange: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const categories = useAsync<Category[]>(() => api.get(endpoints.products.categoriesAll, true));
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The slug follows the name while it is untouched; typing in it takes over from there,
  // so an existing category's URL never changes behind the operator's back on a rename.
  const [slugTouched, setSlugTouched] = useState(false);
  const effectiveSlug = slugTouched ? slug : slugify(name);

  function reset() {
    setEditId(null);
    setName('');
    setSlug('');
    setSlugTouched(false);
    setError(null);
  }

  function edit(c: Category) {
    setEditId(c.id);
    setName(c.name);
    setSlug(c.slug);
    setSlugTouched(true);
    setError(null);
  }

  async function submit() {
    if (!name.trim()) return setError(t('hq.catalog.categories.needName'));
    if (!effectiveSlug) return setError(t('hq.catalog.categories.needSlug'));
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), slug: effectiveSlug };
      if (editId) {
        await api.patch(endpoints.products.category(editId), payload, true);
      } else {
        await api.post(endpoints.products.categoryCreate, payload, true);
      }
      reset();
      categories.reload();
      onChange(); // the product editor's dropdown reads the public list, not this one
      toast(t('hq.catalog.categories.saved'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.catalog.categories.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: Category) {
    setError(null);
    try {
      // Deactivating is a soft delete: products keep the category, it just stops showing
      // as a pill in the shop. Reactivating is the same PATCH the other way.
      if (c.active) {
        await api.del(endpoints.products.category(c.id), true);
      } else {
        await api.patch(endpoints.products.category(c.id), { active: true }, true);
      }
      categories.reload();
      onChange(); // the product editor's dropdown reads the public list, not this one
      toast(t('hq.catalog.categories.saved'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.catalog.categories.saveError'));
    }
  }

  const rows = categories.data ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">{t('hq.catalog.categories.title')}</h2>
        <p className="text-sm text-muted">{t('hq.catalog.categories.subtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label={t('hq.catalog.categories.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Air Minum" />
        </Field>
        <Field label={t('hq.catalog.categories.slug')}>
          <Input
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="air-minum"
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={submit} loading={busy}>
            {editId ? t('hq.catalog.save') : t('hq.catalog.categories.add')}
          </Button>
          {editId && (
            <Button variant="ghost" onClick={reset}>
              {t('hq.catalog.cancel')}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {categories.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : categories.error ? (
        <ErrorState message={categories.error} onRetry={categories.reload} />
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-muted">{t('hq.catalog.categories.empty')}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="font-medium">{c.name}</span>
              <span className="font-mono text-xs text-muted">/{c.slug}</span>
              <Badge tone={c.active ? 'success' : 'neutral'}>
                {c.active ? t('hq.catalog.available') : t('hq.catalog.unavailable')}
              </Badge>
              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={() => edit(c)}
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t('hq.catalog.categories.rename')}
                </button>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  {c.active
                    ? t('hq.catalog.categories.deactivate')
                    : t('hq.catalog.categories.reactivate')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Design 18a — network product catalog. Real: products.browse + create/update + categories.
export default function HqCatalogPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const catalog = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 100 }), true));
  const categories = useAsync<Category[]>(() => api.get(endpoints.products.categories));

  const products = catalog.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.catalog.title')}</h1>
            <p className="text-sm text-muted">{t('hq.catalog.subtitle')}</p>
          </div>
        </div>
        {editing === undefined && <Button onClick={() => setEditing(null)}>{t('hq.catalog.newProduct')}</Button>}
      </div>

      {editing !== undefined && (
        <ProductEditor
          product={editing}
          categories={categories.data ?? []}
          onCancel={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            toast(t('hq.catalog.saved'), 'success');
            catalog.reload();
          }}
        />
      )}

      {catalog.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : catalog.error ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} />
      ) : products.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.catalog.empty')}</p>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">{t('hq.catalog.fields.name')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.catalog.sku')}</th>
                <th className="px-4 py-3 text-right font-medium">{t('hq.catalog.basePrice')}</th>
                <th className="px-4 py-3 font-medium">{t('hq.catalog.availability')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-1 text-xs text-muted">/ {p.unit}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{p.sku}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/hq/pricing" className="font-medium text-brand-700 hover:underline">
                      <Money amount={p.basePrice} />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={p.active ? 'success' : 'neutral'}>
                      {p.active ? t('hq.catalog.available') : t('hq.catalog.unavailable')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      {t('hq.catalog.editorEdit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <CategoryManager onChange={categories.reload} />

      <Link href="/hq/pricing" className="text-sm font-semibold text-brand-700 hover:underline">
        {t('hq.catalog.pricingLink')}
      </Link>
    </div>
  );
}
