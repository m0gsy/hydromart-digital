'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Drop,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Trash,
} from '@phosphor-icons/react';

import { QuantityStepper } from '@/components/quantity-stepper';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { ErrorState, LinkButton, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Cart, CartLine, LoyaltyAccount, Recommendation } from '@/lib/types';

function CartInner() {
  const { t } = useT();
  const { toast } = useToast();
  const { refresh, bump } = useCart();

  const { data, error, loading, reload } = useAsync<Cart>(() => api.get(endpoints.cart.view, true));
  // Fail-soft: no membership / signed-out loyalty → rate stays 0, no error surfaced.
  const { data: account } = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  const recs = useAsync<Recommendation[]>(() =>
    api.get(endpoints.recommendations.trending({ limit: 4 })),
  );

  // Local, authoritative view of the lines — seeded from the fetch, then mutated
  // optimistically so qty/remove don't reload the whole list (kills the flicker).
  const [lines, setLines] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (data) {
      setLines(data.items);
      seeded.current = true;
    }
  }, [data]);

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const rate = account?.discountRate ?? 0;
  const discount = Math.floor(subtotal * rate);
  const total = subtotal - discount;

  async function setQuantity(productId: string, quantity: number) {
    const prev = lines;
    const line = prev.find((l) => l.productId === productId);
    if (!line) return;
    const delta = quantity - line.quantity;
    setLines(
      prev.map((l) =>
        l.productId === productId ? { ...l, quantity, lineTotal: l.unitPrice * quantity } : l,
      ),
    );
    setBusy(productId);
    bump(delta);
    try {
      await api.put(endpoints.cart.item(productId), { quantity }, true);
      await refresh();
    } catch {
      setLines(prev);
      bump(-delta);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function remove(productId: string) {
    const prev = lines;
    const line = prev.find((l) => l.productId === productId);
    if (!line) return;
    setLines(prev.filter((l) => l.productId !== productId));
    setBusy(productId);
    bump(-line.quantity);
    try {
      await api.del(endpoints.cart.item(productId), true);
      await refresh();
    } catch {
      setLines(prev);
      bump(line.quantity);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    const prev = lines;
    setLines([]);
    bump(-totalQty);
    try {
      await api.del(endpoints.cart.clear, true);
      await refresh();
    } catch {
      setLines(prev);
      bump(totalQty);
      reload();
    }
  }

  // Recommendation has no price, so we can't build the new line optimistically —
  // re-pull the cart after the add so the priced line lands without a page skeleton.
  async function addOn(productId: string) {
    bump(1);
    try {
      await api.post(endpoints.cart.items, { productId, quantity: 1 }, true);
      const fresh = await api.get<Cart>(endpoints.cart.view, true);
      setLines(fresh.items);
      await refresh();
      toast(t('order.toast.added'));
    } catch {
      bump(-1);
      toast(t('order.toast.addFailed'), 'error');
    }
  }

  if (loading || (!seeded.current && !error)) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (lines.length === 0) {
    return (
      <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-3 rounded-[20px] border border-app surface px-6 py-[34px] text-center shadow-card">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <ShoppingCart size={28} weight="fill" />
        </div>
        <h2 className="text-[16px] font-extrabold">{t('order.cart.emptyTitle')}</h2>
        <p className="text-[13.5px] leading-relaxed text-muted">{t('order.cart.emptyBody')}</p>
        <LinkButton href="/products" className="mt-1 rounded-full">
          {t('order.cart.startShopping')}
          <ArrowRight size={16} />
        </LinkButton>
      </div>
    );
  }

  const recItems = recs.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[30px] font-extrabold tracking-[-0.03em]">
        {t('order.cart.title')}{' '}
        <span className="text-[15px] font-bold text-muted">
          {t('order.cart.itemCount', { n: totalQty })}
        </span>
      </h1>

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* lines */}
        <div className="flex flex-col gap-3">
          {lines.map((line) => (
            <div
              key={line.productId}
              className="surface flex flex-wrap items-center gap-4 rounded-[20px] p-4 shadow-card"
            >
              <div className="flex h-[84px] w-[84px] flex-shrink-0 items-center justify-center rounded-[14px] bg-[color:var(--surface-soft)]">
                <Drop size={30} weight="thin" className="text-brand-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">{line.productName}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  <Money amount={line.unitPrice} /> · {line.unit}
                </p>
                {/* ponytail: cart lines carry no depot, so the label is fixed. Add an
                    i18n key + real depot label when the cart exposes stock-by-depot. */}
                <span className="mt-1.5 inline-flex rounded-full bg-brand-50 px-[9px] py-0.5 text-[11px] font-bold text-brand-800">
                  Stok tersedia
                </span>
              </div>
              <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-start">
                <QuantityStepper
                  value={line.quantity}
                  onChange={(q) => setQuantity(line.productId, q)}
                  disabled={busy === line.productId}
                />
                <div className="w-[92px] text-right text-[15.5px] font-extrabold tabular-nums">
                  <Money amount={line.lineTotal} />
                </div>
                <button
                  type="button"
                  aria-label={t('order.cart.removeAria', { name: line.productName })}
                  onClick={() => remove(line.productId)}
                  disabled={busy === line.productId}
                  className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)] active:scale-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <Trash size={18} />
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between px-1 py-1.5">
            <button
              onClick={clear}
              className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-muted transition-colors hover:text-[color:var(--danger)]"
            >
              <Trash size={15} />
              {t('order.cart.clear')}
            </button>
            <Link
              href="/products"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-brand-600 transition-colors hover:text-brand-700"
            >
              <ArrowLeft size={15} />
              {t('order.cart.continueShopping')}
            </Link>
          </div>

          {/* add-on rail */}
          {recItems.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-3 text-[17px] font-extrabold tracking-tight">
                {t('order.cart.addOnTitle')}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {recItems.map((rec) => (
                  <div
                    key={rec.productId}
                    className="surface flex items-center gap-3 rounded-[16px] p-[11px] shadow-card"
                  >
                    <Link
                      href={`/products/${rec.productId}`}
                      className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-soft)]"
                    >
                      <Drop size={22} weight="thin" className="text-brand-300" />
                    </Link>
                    <Link
                      href={`/products/${rec.productId}`}
                      className="min-w-0 flex-1 text-[13px] font-bold leading-snug hover:text-brand-700"
                    >
                      <span className="line-clamp-2">{rec.name}</span>
                    </Link>
                    <button
                      onClick={() => addOn(rec.productId)}
                      aria-label={t('order.cart.addOnAria', { name: rec.name })}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-800 transition-colors hover:bg-brand-600 hover:text-on-brand"
                    >
                      <Plus size={14} weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* summary */}
        <div className="surface flex flex-col gap-3.5 rounded-[22px] p-6 shadow-card lg:sticky lg:top-20">
          <h2 className="text-[17px] font-extrabold">{t('order.cart.summary')}</h2>
          <div className="flex justify-between text-[14px]">
            <span className="text-muted">{t('order.cart.subtotal')}</span>
            <Money amount={subtotal} className="font-bold" />
          </div>
          {rate > 0 && (
            <div className="flex justify-between text-[14px]">
              <span className="text-muted">
                {t('order.cart.memberDiscount', { pct: Math.round(rate * 100) })}
              </span>
              <span className="font-bold text-[color:var(--success)]">
                −<Money amount={discount} />
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-[color:var(--border-soft)] pt-3.5 text-[16px] font-extrabold">
            <span>{t('order.cart.estTotal')}</span>
            <Money amount={total} />
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t('order.cart.shippingNote')}
          </p>
          <LinkButton href="/checkout" className="h-13 w-full rounded-full text-[15px] font-extrabold">
            {t('order.cart.checkout')}
            <ArrowRight size={17} />
          </LinkButton>
          <div className="flex items-center gap-2 rounded-[14px] bg-amber-50 px-3.5 py-[11px] text-[12.5px] text-amber-900">
            <Tag size={16} weight="fill" className="flex-shrink-0 text-amber-600" />
            {t('order.cart.voucherHint')}
          </div>
          <div className="flex justify-center gap-4 pt-1 text-[11.5px] font-bold text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={14} weight="fill" className="text-brand-600" />
              {t('order.cart.trustSecure')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={14} weight="fill" className="text-brand-600" />
              {t('order.cart.trustFast')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Drop size={14} weight="fill" className="text-brand-600" />
              {t('order.cart.trustSealed')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CartPage() {
  return (
    <RequireAuth>
      <CartInner />
    </RequireAuth>
  );
}
