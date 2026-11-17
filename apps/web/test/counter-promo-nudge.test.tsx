// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/locale-context', async () => {
  const { id } = await import('@/lib/dictionaries/id');
  const lookup = (key: string, vars: Record<string, string | number> = {}) => {
    const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], id);
    return String(raw ?? key).replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ''));
  };
  return { useT: () => ({ t: lookup }) };
});

import { CounterPromoStrip, counterPromoNudge } from '@/components/dashboard/counter-promos';
import type { PromoRule } from '@/lib/types';

const t = (key: string, vars: Record<string, string | number> = {}) =>
  `${key}${JSON.stringify(vars)}`;
const name = (id: string) => (id === 'p-air' ? 'Air Galon 19L' : undefined);

const rule = (o: Partial<PromoRule>): PromoRule =>
  ({
    id: 'r-1',
    name: 'Promo',
    kind: 'BUY_X_GET_Y',
    productId: 'p-air',
    buyQty: 2,
    getQty: 1,
    minQty: 1,
    maxQty: null,
    minSubtotal: null,
    firstOrderOnly: false,
    ...o,
  }) as PromoRule;

const basket = (q: number, subtotal: number | null = null) => ({
  qtyOf: (id: string) => (id === 'p-air' ? q : 0),
  subtotal,
});

/*
 * PR-C. The sentence a cashier can say to sell a little more, only where the rule says exactly
 * what is missing.
 */
describe('counterPromoNudge', () => {
  it('names how many more earn the free unit', () => {
    expect(counterPromoNudge(rule({ name: 'Beli 2 Gratis 1' }), basket(1), t, name)).toBe(
      'opsFix.walkIn.nudgeAddMore{"n":1,"name":"Air Galon 19L","promo":"Beli 2 Gratis 1"}',
    );
  });

  it('points at the next bonus once past the first one', () => {
    expect(counterPromoNudge(rule({ buyQty: 3 }), basket(4), t, name)).toContain('"n":2');
  });

  it('says nothing for a product not in the basket, or a bonus already earned', () => {
    expect(counterPromoNudge(rule({}), basket(0), t, name)).toBeNull();
    expect(counterPromoNudge(rule({}), basket(2), t, name)).toBeNull();
  });

  it('never promises past the rule ceiling or to a buyer it cannot check', () => {
    expect(counterPromoNudge(rule({ maxQty: 1 }), basket(1), t, name)).toBeNull();
    expect(counterPromoNudge(rule({ firstOrderOnly: true }), basket(1), t, name)).toBeNull();
  });

  it('counts a minimum quantity for a price promo', () => {
    expect(
      counterPromoNudge(rule({ kind: 'SPECIAL_PRICE', minQty: 3 }), basket(1), t, name),
    ).toContain('"n":2');
  });

  it('names the rupiah still missing for an order discount, from the priced subtotal only', () => {
    const r = rule({ kind: 'ORDER_DISCOUNT', productId: null, minSubtotal: 50000, name: 'Belanja Hemat' });
    expect(counterPromoNudge(r, basket(2, 40000), t, name)).toBe(
      'opsFix.walkIn.nudgeSpendMore{"amount":"Rp 10.000","promo":"Belanja Hemat"}',
    );
    expect(counterPromoNudge(r, basket(2, null), t, name)).toBeNull();
    expect(counterPromoNudge(r, basket(3, 60000), t, name)).toBeNull();
  });
});

describe('CounterPromoStrip', () => {
  it('ticks the promo the server applied to this basket and nudges the one it is close to', () => {
    render(
      <CounterPromoStrip
        rules={[
          rule({ id: 'a', name: 'Beli 2 Gratis 1' }),
          rule({ id: 'b', name: 'Harga Grosir', kind: 'SPECIAL_PRICE', minQty: 3 }),
        ]}
        productName={name}
        appliedIds={new Set(['a'])}
        basket={basket(2)}
      />,
    );
    expect(screen.getByText('✓ Berlaku')).toBeTruthy();
    expect(screen.getByText('Tambah 1 Air Galon 19L lagi → Harga Grosir')).toBeTruthy();
  });
});
