// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, getPushState, subscribeToPush, unsubscribeFromPush } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  getPushState: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/push', () => ({ getPushState, subscribeToPush, unsubscribeFromPush }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null, ready: true }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom ships no `matchMedia`, and ThemeProvider reads the OS colour-scheme through it.
// Faking the browser API rather than mocking the provider: the provider is part of what
// this screen is, and mocking it would load a second instance nothing ever runs.
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

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { ThemeProvider } from '@/lib/theme-context';
import AccountPage from '@/app/account/page';

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
  await userEvent.click(await screen.findByText(/preferensi|preferences/i));
}

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/profile/notifications'))
      return Promise.resolve({ push: false, categories: {} });
    if (p.includes('/loyalty/me'))
      return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  patch.mockReset().mockResolvedValue({});
  getPushState.mockReset().mockResolvedValue('unsubscribed');
  subscribeToPush.mockReset().mockResolvedValue('subscribed');
  unsubscribeFromPush.mockReset().mockResolvedValue('unsubscribed');
});
afterEach(() => vi.clearAllMocks());

/**
 * F6. The push switch in Preferences wrote a preference row and did nothing else: it never
 * asked the OS for permission and never registered the device. So a customer who had never
 * placed an order — the only moment the app asks, via `requestPushOnce` — could turn it on,
 * see it stay on, and never receive a single notification for as long as they kept the app.
 *
 * The switch is the device's real state now, not a wish about it.
 */
describe('F6 — the push switch that never asked', () => {
  it('subscribes the device when it is switched on', async () => {
    await openPrefs();
    await userEvent.click(await screen.findByRole('switch', { name: /notifikasi|push/i }));

    await waitFor(() => expect(subscribeToPush).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalled();
  });

  it('unsubscribes the device when it is switched off', async () => {
    getPushState.mockResolvedValue('subscribed');
    get.mockImplementation((path: string) =>
      String(path).includes('/profile/notifications')
        ? Promise.resolve({ push: true, categories: {} })
        : Promise.resolve([]),
    );
    await openPrefs();
    await userEvent.click(await screen.findByRole('switch', { name: /notifikasi|push/i }));

    await waitFor(() => expect(unsubscribeFromPush).toHaveBeenCalledTimes(1));
  });

  it('does not claim to be on when the OS refused', async () => {
    subscribeToPush.mockResolvedValue('denied');
    await openPrefs();
    const sw = await screen.findByRole('switch', { name: /notifikasi|push/i });
    await userEvent.click(sw);

    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(await screen.findByText(/setelan perangkat|device settings/i)).toBeInTheDocument();
  });

  it('says so plainly on a device that cannot do push at all', async () => {
    getPushState.mockResolvedValue('unsupported');
    await openPrefs();
    const sw = await screen.findByRole('switch', { name: /notifikasi|push/i });
    await waitFor(() => expect(sw).toBeDisabled());
  });

  it('reflects the device, not the stored wish, when the two disagree', async () => {
    // Preference says ON, device was never registered — which is exactly the state F6
    // could leave someone in. The switch must show the truth.
    get.mockImplementation((path: string) =>
      String(path).includes('/profile/notifications')
        ? Promise.resolve({ push: true, categories: {} })
        : Promise.resolve([]),
    );
    getPushState.mockResolvedValue('unsubscribed');
    await openPrefs();
    const sw = await screen.findByRole('switch', { name: /notifikasi|push/i });
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
  });
});
