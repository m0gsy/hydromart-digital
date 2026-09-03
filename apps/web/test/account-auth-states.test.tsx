// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

// Mutable so one file can drive the three states `/account` actually has.
const auth = {
  customer: null as { id: string; role: string; fullName: string; phone: string } | null,
  ready: false,
};

vi.mock('@/lib/api', () => ({ api: { get, getCached, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: auth.ready, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import AccountPage from '@/app/account/page';

beforeEach(() => {
  auth.customer = null;
  auth.ready = false;
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/loyalty/me'))
      return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    if (p.includes('/profile/notifications')) return Promise.resolve({});
    return Promise.resolve([]);
  });
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H6. `if (!customer) return null` ran for the whole window between mount and `ready`,
 * so /account rendered a BLANK PAGE while auth settled. That window is not instant on the
 * device this ships to: a cold start can wait several seconds on a biometric unlock, and
 * for all of it the screen said nothing at all — indistinguishable from a crash.
 *
 * H7. The guest CTA pointed at `/login` with no `?next=`, so signing in from the account
 * screen landed the customer in the catalogue rather than back where they asked to be.
 */
describe('/account — the three states it has', () => {
  it('says it is loading rather than rendering nothing while auth settles', async () => {
    auth.ready = false;
    auth.customer = null;
    const { container } = render(<AccountPage />, { wrapper: LocaleProvider });

    // Not asserted on text: a skeleton has none, which is the point. What must exist is a
    // rendered, announced busy region — the previous code rendered NOTHING, so the check
    // that matters is "the container is not empty and says it is working".
    expect(container.firstElementChild).not.toBeNull();
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('sends a guest to sign in and back to /account, not to the catalogue', async () => {
    auth.ready = true;
    auth.customer = null;
    render(<AccountPage />, { wrapper: LocaleProvider });

    const cta = await screen.findByRole('link', { name: /masuk|sign in/i });
    expect(cta).toHaveAttribute('href', `/login?next=${encodeURIComponent('/account')}`);
  });

  it('draws the account itself once the customer is known', async () => {
    auth.ready = true;
    auth.customer = { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '081234567890' };
    render(<AccountPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText('Wahyu')).toBeInTheDocument();
  });
});
