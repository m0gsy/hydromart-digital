// @vitest-environment jsdom
/*
 * W3 — the Home loyalty card printed a discount ladder nobody offers.
 *
 * Measured live 2026-08-27:
 *
 *   curl https://api.hydromart-digital.com/loyalty/api/v1/loyalty/tiers
 *   → SILVER, GOLD and PLATINUM all come back with discountRate 0
 *
 * The product detail page (`account.discountRate > 0`), the checkout summary
 * (`membershipDiscount > 0`) and the rewards hero (`account.discountRate > 0`) each
 * already hide their own row on a zero rate. This card had no guard at all, so the
 * FIRST screen a guest sees advertised "SILVER 0% · GOLD 0% · PLATINUM 0%" — the
 * loudest place in the app to state a benefit that does not exist.
 *
 * The guard here is the same per-row shape as the other three: a tier with no discount
 * drops out, and a ladder with nothing left in it does not render.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));

const auth = vi.hoisted(() => ({ customer: null as unknown }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { LoyaltyHighlight } from '@/components/loyalty-highlight';
import type { LoyaltyAccount, TierBenefit } from '@/lib/types';

const tier = (name: string, threshold: number, discountRate: number): TierBenefit =>
  ({ tier: name, threshold, discountRate }) as TierBenefit;

const account = (discountRate: number): LoyaltyAccount =>
  ({
    tier: 'SILVER',
    pointsBalance: 1_250,
    lifetimePoints: 1_250,
    discountRate,
  }) as LoyaltyAccount;

/** Wire the two reads the card makes; `me` is only asked for when signed in. */
const serve = (tiers: TierBenefit[], me: LoyaltyAccount | null): void => {
  get.mockReset().mockImplementation(async (path: string) => {
    if (String(path).includes('/loyalty/tiers')) return tiers;
    return me;
  });
};

const draw = async () => {
  render(
    <LocaleProvider>
      <LoyaltyHighlight />
    </LocaleProvider>,
  );
  // Both reads resolve on the microtask queue; one flush is enough to paint them.
  await screen.findByRole('heading');
};

beforeEach(() => {
  auth.customer = null;
});
afterEach(() => vi.clearAllMocks());

describe('W3 — Home loyalty card and a tier ladder that discounts nothing', () => {
  it('shows no ladder at all when every tier is on 0% (production, today)', async () => {
    serve([tier('SILVER', 500, 0), tier('GOLD', 2_000, 0), tier('PLATINUM', 5_000, 0)], null);
    await draw();

    expect(screen.queryAllByText(/0\s*%/)).toHaveLength(0);
    expect(screen.queryByText(/SILVER/)).toBeNull();
    expect(screen.queryByText(/PLATINUM/)).toBeNull();
    // The card itself stays: points still accrue and still redeem, so the sign-up CTA
    // is still an honest offer.
    expect(screen.getByText(/Daftar gratis/)).toBeInTheDocument();
  });

  it('keeps the tiers that do discount and drops only the ones that do not', async () => {
    serve([tier('SILVER', 500, 0), tier('GOLD', 2_000, 0.05)], null);
    await draw();

    expect(screen.getByText(/GOLD/)).toBeInTheDocument();
    expect(screen.getByText(/5\s*%/)).toBeInTheDocument();
    expect(screen.queryByText(/SILVER/)).toBeNull();
  });

  it('states no member discount to a signed-in member whose tier gives none', async () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER' };
    serve([tier('SILVER', 500, 0), tier('GOLD', 2_000, 0)], account(0));
    await draw();

    // The balance is still the point of the card — only the 0% claim goes.
    expect(screen.getByText('1.250')).toBeInTheDocument();
    expect(screen.queryByText(/diskon member/i)).toBeNull();
    expect(screen.queryByText(/diskon naik ke/i)).toBeNull();
    expect(screen.queryAllByText(/0\s*%/)).toHaveLength(0);
  });

  it('still states a real rate, and a real one on the next tier up', async () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER' };
    serve([tier('SILVER', 500, 0.03), tier('GOLD', 2_000, 0.07)], account(0.03));
    await draw();

    expect(screen.getByText(/diskon member 3%/i)).toBeInTheDocument();
    expect(screen.getByText(/diskon naik ke 7%/i)).toBeInTheDocument();
  });
});
