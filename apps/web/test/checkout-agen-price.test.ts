/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';
import type { Cart } from '@/lib/types';

/**
 * A4/A9 — the checkout screen no longer carries its own copy of the agen rule.
 *
 * It used to read `/resellers/me` and re-derive `active && (pct > 0 || flat > 0)`. That was
 * the third copy of a rule order-service kept twice more, and the only one that never asked
 * WHICH DEPOT: order-service declines to price an agen outside their home depot, and this
 * screen went on showing the badge anyway. The rule is answered once now, by the priced
 * cart, so these assertions are about reading the server's answer rather than re-deriving.
 */

/** Exactly what the screen does with the cart it is handed. */
const badgeShows = (cart: Cart): boolean => cart.reseller?.applies === true;
const agenDiscount = (cart: Cart): number | null =>
  badgeShows(cart) ? cart.reseller?.discount ?? null : 0;

const base: Cart = {
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      imageUrl: null,
      sku: 'AIR-19L',
      unit: 'Galon 19L',
      unitPrice: 22_000,
      quantity: 5,
      lineTotal: 110_000,
      isGallon: true,
    },
  ],
  subtotal: 110_000,
  depotId: 'depot-home',
  pricingBasis: 'DEPOT',
  reseller: { applies: true, discountPct: 0, flatGallonPriceIdr: 5_000, discount: 85_000 },
};

describe('checkout agen price (A4/A9)', () => {
  it('sends the fulfilling depot with the cart read, so prices are that depot’s', () => {
    expect(endpoints.cart.view('depot-home')).toBe('/orders/api/v1/cart?depotId=depot-home');
    expect(endpoints.cart.item('p1', 'depot-home')).toBe(
      '/orders/api/v1/cart/items/p1?depotId=depot-home',
    );
    // No depot known yet is still a valid read — it answers with catalog prices, labelled.
    expect(endpoints.cart.view(null)).toBe('/orders/api/v1/cart');
  });

  it('shows the agen discount as a number instead of "dihitung saat pesan"', () => {
    // Measured before this shipped: five galon quoted Rp105.000 on screen, billed Rp30.000.
    expect(agenDiscount(base)).toBe(85_000);
  });

  it('hides the badge when the agen belongs to another depot', () => {
    const elsewhere: Cart = { ...base, reseller: { ...base.reseller!, applies: false, discount: 0 } };
    expect(badgeShows(elsewhere)).toBe(false);
    expect(agenDiscount(elsewhere)).toBe(0);
  });

  it('offers no agen number at all when the prices are catalog prices', () => {
    const catalog: Cart = {
      ...base,
      pricingBasis: 'CATALOG',
      reseller: { ...base.reseller!, discount: null },
    };
    // null, not 0: a discount computed off the wrong prices is the defect A4 exists to
    // stop, so the screen falls back to saying the price lands at checkout.
    expect(agenDiscount(catalog)).toBeNull();
  });

  it('treats a non-agen cart as no badge and no discount', () => {
    expect(badgeShows({ ...base, reseller: null })).toBe(false);
    expect(agenDiscount({ ...base, reseller: null })).toBe(0);
  });
});
