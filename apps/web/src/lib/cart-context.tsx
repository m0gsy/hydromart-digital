'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAuth } from './auth-context';
import type { Cart } from './types';

interface CartValue {
  cart: Cart | null;
  /** total item quantity — for the nav badge */
  count: number;
  ready: boolean;
  /** re-pull the authoritative cart from the server */
  refresh: () => Promise<void>;
  /** optimistic badge bump before a mutation resolves (server refresh corrects it) */
  bump: (delta: number) => void;
}

const CartContext = createContext<CartValue | null>(null);

const countOf = (cart: Cart | null) =>
  cart ? cart.items.reduce((n, i) => n + i.quantity, 0) : 0;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  const pathname = usePathname();
  const [cart, setCart] = useState<Cart | null>(null);
  const [optimistic, setOptimistic] = useState(0);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!customer) {
      setCart(null);
      setReady(true);
      return;
    }
    try {
      const next = await api.get<Cart>(endpoints.cart.view, true);
      setCart(next);
      setOptimistic(0);
    } catch {
      setCart(null);
    } finally {
      setReady(true);
    }
  }, [customer]);

  // Refresh on sign-in change and on navigation. ponytail: the per-nav refresh
  // bridges the badge until add-to-cart callers use bump()/refresh() directly.
  useEffect(() => {
    setOptimistic(0);
    void refresh();
  }, [refresh, pathname]);

  const value = useMemo<CartValue>(
    () => ({
      cart,
      count: Math.max(0, countOf(cart) + optimistic),
      ready,
      refresh,
      bump: (delta) => setOptimistic((o) => o + delta),
    }),
    [cart, optimistic, ready, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
