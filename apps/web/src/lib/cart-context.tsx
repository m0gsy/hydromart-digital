'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { cartDepotId } from './location-store';
import { useAuth } from './auth-context';
import type { Cart } from './types';

interface CartValue {
  cart: Cart | null;
  /** total item quantity — for the nav badge */
  count: number;
  ready: boolean;
  /** re-pull the authoritative cart from the server */
  refresh: () => Promise<void>;
  /**
   * Audit F-7: adopt the cart a mutation already returned. Every cart write
   * (`POST /cart/items`, `PUT`, `DELETE`) answers with the full, priced CartView,
   * and the app used to throw it away and re-`GET` the same thing — two round-trips
   * for one action, on the slowest network the app runs on.
   */
  apply: (cart: Cart) => void;
  /** optimistic badge bump before a mutation resolves (server refresh corrects it) */
  bump: (delta: number) => void;
}

const CartContext = createContext<CartValue | null>(null);

const countOf = (cart: Cart | null) =>
  cart ? cart.items.reduce((n, i) => n + i.quantity, 0) : 0;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
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
      const next = await api.get<Cart>(endpoints.cart.view(cartDepotId()), true);
      setCart(next);
      setOptimistic(0);
    } catch {
      setCart(null);
    } finally {
      setReady(true);
    }
  }, [customer]);

  const apply = useCallback((next: Cart) => {
    setCart(next);
    setOptimistic(0);
    setReady(true);
  }, []);

  // Audit F-1/F-13: this used to re-`GET /cart` on EVERY navigation, because the
  // add-to-cart callers only nudged the badge and left the provider to catch up.
  // They now adopt the CartView their own mutation returned (`apply`), so the cart
  // is read exactly once per sign-in instead of once per page the shopper opens.
  useEffect(() => {
    setOptimistic(0);
    void refresh();
  }, [refresh]);

  const value = useMemo<CartValue>(
    () => ({
      cart,
      count: Math.max(0, countOf(cart) + optimistic),
      ready,
      refresh,
      apply,
      bump: (delta) => setOptimistic((o) => o + delta),
    }),
    [cart, optimistic, ready, refresh, apply],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
