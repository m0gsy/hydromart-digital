'use client';

import { useState } from 'react';
import { ShoppingCart, Trash } from '@phosphor-icons/react';

import { QuantityStepper } from '@/components/quantity-stepper';
import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, LinkButton, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Cart } from '@/lib/types';

function CartInner() {
  const { data, error, loading, reload } = useAsync<Cart>(() => api.get(endpoints.cart.view, true));
  const [busy, setBusy] = useState<string | null>(null);

  async function setQuantity(productId: string, quantity: number) {
    setBusy(productId);
    try {
      await api.put(endpoints.cart.item(productId), { quantity }, true);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function remove(productId: string) {
    setBusy(productId);
    try {
      await api.del(endpoints.cart.item(productId), true);
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.items.length === 0) {
    return (
      <CenterState
        icon={<ShoppingCart size={48} weight="thin" />}
        title="Your cart is empty"
        action={<LinkButton href="/products">Browse products</LinkButton>}
      >
        Add some galons or bottled water to get started.
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Cart</h1>

      <ul className="flex flex-col gap-3">
        {data.items.map((line) => (
          <Card key={line.productId} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{line.productName}</p>
              <p className="text-xs text-muted">
                <Money amount={line.unitPrice} /> · {line.unit}
              </p>
            </div>
            <QuantityStepper
              value={line.quantity}
              onChange={(q) => setQuantity(line.productId, q)}
              disabled={busy === line.productId}
            />
            <div className="w-24 text-right text-sm font-bold">
              <Money amount={line.lineTotal} />
            </div>
            <button
              aria-label={`Remove ${line.productName}`}
              onClick={() => remove(line.productId)}
              disabled={busy === line.productId}
              className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash size={18} />
            </button>
          </Card>
        ))}
      </ul>

      <Card className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted">Subtotal</p>
          <p className="text-xl font-bold">
            <Money amount={data.subtotal} />
          </p>
          <p className="text-xs text-muted">Delivery fee is calculated at checkout.</p>
        </div>
        <LinkButton href="/checkout">Checkout</LinkButton>
      </Card>

      <div>
        <Button
          variant="ghost"
          onClick={async () => {
            await api.del(endpoints.cart.clear, true);
            reload();
          }}
        >
          Empty cart
        </Button>
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
