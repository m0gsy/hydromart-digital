'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Info, Package, Plus, Trash } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Page, Product } from '@/lib/types';

/** Create/edit form for a product (POST create / PATCH update). */
function ProductForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Product;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [basePrice, setBasePrice] = useState(initial ? String(initial.basePrice) : '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  // Additional gallery image URLs beyond the primary imageUrl.
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setImageAt = (i: number, v: string) =>
    setImages((arr) => arr.map((u, j) => (j === i ? v : u)));
  const removeImageAt = (i: number) => setImages((arr) => arr.filter((_, j) => j !== i));
  const moveImage = (i: number, dir: -1 | 1) =>
    setImages((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function submit() {
    const price = Number(basePrice);
    if (!name.trim() || !sku.trim() || !unit.trim() || !Number.isFinite(price) || price < 0) {
      setError(t('dashC.productsManage.formInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      sku: sku.trim(),
      unit: unit.trim(),
      basePrice: price,
      imageUrl: imageUrl.trim() || null,
      images: images.map((u) => u.trim()).filter(Boolean),
    };
    try {
      if (initial) await api.patch(endpoints.products.update(initial.id), body, true);
      else await api.post(endpoints.products.create, body, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.productsManage.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{editing ? t('dashC.productsManage.editTitle') : t('dashC.productsManage.newTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('dashC.productsManage.name')} htmlFor="pf-name">
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('dashC.productsManage.sku')} htmlFor="pf-sku">
          <Input id="pf-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label={t('dashC.productsManage.unit')} htmlFor="pf-unit" hint={t('dashC.productsManage.unitHint')}>
          <Input id="pf-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <Field label={t('dashC.productsManage.basePrice')} htmlFor="pf-price">
          <Input
            id="pf-price"
            type="number"
            inputMode="numeric"
            min={0}
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('dashC.productsManage.mainImage')} htmlFor="pf-image" hint={t('dashC.productsManage.mainImageHint')}>
        <Input id="pf-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label={t('dashC.productsManage.extraImages')} hint={t('dashC.productsManage.extraImagesHint')}>
        <div className="flex flex-col gap-2">
          {images.map((url, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={url}
                onChange={(e) => setImageAt(i, e.target.value)}
                placeholder="https://…"
                aria-label={t('dashC.productsManage.extraImageAria', { n: i + 1 })}
              />
              <Button
                variant="ghost"
                onClick={() => moveImage(i, -1)}
                disabled={i === 0}
                aria-label={t('dashC.productsManage.moveUp')}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                variant="ghost"
                onClick={() => moveImage(i, 1)}
                disabled={i === images.length - 1}
                aria-label={t('dashC.productsManage.moveDown')}
              >
                <ArrowDown size={16} />
              </Button>
              <Button
                variant="ghost"
                className="text-red-600"
                onClick={() => removeImageAt(i)}
                aria-label={t('dashC.productsManage.remove')}
              >
                <Trash size={16} />
              </Button>
            </div>
          ))}
          <Button variant="ghost" className="w-fit" onClick={() => setImages((arr) => [...arr, ''])}>
            <Plus size={16} /> {t('dashC.productsManage.addImage')}
          </Button>
        </div>
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('dashC.productsManage.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('dashC.productsManage.save')}
        </Button>
      </div>
    </Card>
  );
}

function ProductItem({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.products.remove(product.id), true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.productsManage.deactivateError'));
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <ProductForm
        initial={product}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

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
          {/* ponytail: per-depot stock lives in depot-service inventory — separate view. */}
          {t('dashC.productsManage.skuStock', { sku: product.sku, unit: product.unit })}
        </p>
        {error && (
          <p className="mt-1 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <Money amount={product.basePrice} className="shrink-0 font-semibold" />
      <Badge tone={product.active ? 'success' : 'neutral'}>{product.active ? t('dashC.productsManage.active') : t('dashC.productsManage.inactive')}</Badge>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
          {t('dashC.productsManage.edit')}
        </Button>
        {product.active && (
          <Button variant="ghost" className="text-red-600" onClick={deactivate} loading={busy}>
            {t('dashC.productsManage.deactivate')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ProductsManageBody() {
  const { t } = useT();
  const { selected, depots, scopedId } = useDepot();
  const products = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 100 }), true), []);
  const [creating, setCreating] = useState(false);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const items = products.data?.items ?? [];
  const activeCount = items.filter((p) => p.active).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashC.productsManage.heading')}</h1>
            <p className="text-sm text-muted tabular-nums">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              {t('dashC.productsManage.countLine', { n: items.length, active: activeCount })}
            </p>
          </div>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> {t('dashC.productsManage.newTitle')}
          </Button>
        )}
      </div>

      {creating && (
        <ProductForm
          onDone={() => {
            setCreating(false);
            products.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-muted">
          {t('dashC.productsManage.info')}
        </p>
      </Card>

      {products.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : products.error ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('dashC.productsManage.emptyTitle')} icon={<Package size={40} weight="fill" />}>
          {t('dashC.productsManage.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((p) => (
            <ProductItem key={p.id} product={p} onChanged={products.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotAdmin', customer?.role)) {
    return (
      <CenterState title={t('dashC.productsManage.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.productsManage.gateBody')}
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
