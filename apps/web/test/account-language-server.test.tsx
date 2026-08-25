// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, patch } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

const prefs = { customerId: 'c-1', push: true, email: true, whatsapp: true, categories: {}, locale: 'id' };

vi.mock('@/lib/api', () => ({ api: { get, getCached, post, patch }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '081234567890' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/lib/push', () => ({
  getPushState: () => Promise.resolve('unsubscribed'),
  subscribeToPush: () => Promise.resolve('subscribed'),
  unsubscribeFromPush: () => Promise.resolve('unsubscribed'),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom ships no `matchMedia`, and ThemeProvider reads the OS colour-scheme through it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }),
});

import { LOCALE_STORAGE_KEY, LocaleProvider } from '@/lib/locale-context';
import { ThemeProvider } from '@/lib/theme-context';
import { ToastProvider } from '@/components/toast';
import AccountPage from '@/app/account/page';

beforeEach(() => {
  localStorage.clear();
  prefs.locale = 'id';
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    if (p.includes('/profile/notifications')) return Promise.resolve({ ...prefs });
    return Promise.resolve([]);
  });
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset();
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

/** Open the preferences sheet, where the language switch lives. */
async function openPrefs() {
  render(
    <LocaleProvider>
      <ThemeProvider>
        <ToastProvider>
          <AccountPage />
        </ToastProvider>
      </ThemeProvider>
    </LocaleProvider>,
  );
  const [row] = await screen.findAllByText('Preferensi');
  fireEvent.click(row as HTMLElement);
}

/**
 * K5.3. The switch wrote localStorage and nothing else, so a customer reading the app in
 * English still got every WhatsApp and every push in Indonesian: crm-service renders them
 * server-side and has no browser to ask.
 */
describe('/account — the language switch reaches the sender', () => {
  it('saves the choice on the customer’s row, not only in this browser', async () => {
    await openPrefs();
    fireEvent.click(await screen.findByRole('button', { name: 'en' }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        expect.stringContaining('/profile/notifications'),
        { locale: 'en' },
        true,
      ),
    );
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  // The choice belongs to the person, not to the phone they made it on.
  it('adopts the stored language on a device that was never asked', async () => {
    prefs.locale = 'en';
    await openPrefs();

    await waitFor(() => expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en'));
  });

  // ...but a switch flipped HERE must not lose to the server's older copy on the next paint.
  it('leaves a device that already has an answer alone', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'id');
    prefs.locale = 'en';
    await openPrefs();

    await screen.findAllByText('Preferensi');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('id');
  });
});
