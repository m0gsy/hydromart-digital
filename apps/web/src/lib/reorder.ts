'use client';

import { useRouter } from 'next/navigation';

import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { Cart, Order } from '@/lib/types';

/**
 * "Pesan lagi": put a past order's lines back in the cart and open it. Shared by the order
 * detail and the rows of the order list (flow plan PR-7b).
 *
 * Resolves `null` once the cart is open, or the message to show when it is not.
 */
export function useReorder(): (order: Pick<Order, 'id' | 'items'>) => Promise<string | null> {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  return async (order) => {
    try {
      /*
       * CA-3-28. The server skips any line whose product is gone or deactivated, silently,
       * and this said "Item ditambahkan ke keranjang" either way — including when NOTHING
       * was added. The customer landed on a cart that had not changed, with a green toast
       * saying it had.
       *
       * The answer is the whole priced cart, so the truth is already in hand: a line the
       * cart does not carry was not added.
       */
      const cart = await api.post<Cart>(endpoints.orders.repeat(order.id), {}, true);
      const inCart = new Set(cart.items.map((l) => l.productId));
      const missing = order.items.filter((i) => !inCart.has(i.productId)).length;
      if (missing > 0 && missing === order.items.length) return t('order.detail.repeatNothing');
      toast(
        missing > 0 ? t('order.detail.repeatPartial', { n: missing }) : t('order.toast.itemsAdded'),
      );
      router.push('/cart');
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : t('order.detail.repeatError');
    }
  };
}
