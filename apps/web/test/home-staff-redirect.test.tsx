// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A franchise owner signed in to the Ops app landed on the customer shop: `/` rendered the
 * shop for any signed-in account, and the only place that sends a role to its console is
 * `/verify`, which a long-lived session never revisits. `/` now sends every staff role on.
 */
const { replace, auth } = vi.hoisted(() => ({
  replace: vi.fn(),
  auth: { customer: null as { fullName: string; role: string } | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: auth.customer }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/components/hero', () => ({ Hero: () => null }));
vi.mock('@/components/promo-carousel', () => ({ PromoCarousel: () => null }));
vi.mock('@/components/category-grid', () => ({ CategoryGrid: () => null }));
vi.mock('@/components/nearby-depots', () => ({ NearbyDepots: () => null }));
vi.mock('@/components/loyalty-highlight', () => ({ LoyaltyHighlight: () => null }));
vi.mock('@/components/active-order-card', () => ({ ActiveOrderCard: () => null }));
vi.mock('@/components/product-rec-rail', () => ({ ProductRecRail: () => null }));

import HomePage from '@/app/page';
import { consoleHome } from '@/lib/roles';

const STAFF_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
];

describe('HomePage staff redirect', () => {
  beforeEach(() => replace.mockClear());

  it.each(STAFF_ROLES)('sends %s to its console', (role) => {
    auth.customer = { fullName: 'X', role };
    render(<HomePage />);
    expect(replace).toHaveBeenCalledWith(consoleHome(role));
  });

  it('leaves a customer on the shop', () => {
    auth.customer = { fullName: 'X', role: 'CUSTOMER' };
    render(<HomePage />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves a signed-out visitor on the shop', () => {
    auth.customer = null;
    render(<HomePage />);
    expect(replace).not.toHaveBeenCalled();
  });
});
