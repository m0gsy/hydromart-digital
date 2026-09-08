// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-4-29 — the ETA summary this screen is built around had never once appeared for the
 * person the screen is for.
 *
 * It read `GET settings/schema`, which is gated on `settingsRead`: MANAGER, HEAD_OFFICE,
 * DIREKTUR, FINANCE, SUPER_ADMIN. A courier is none of them, so the call 403'd on every
 * load, `speedKmph` and `stopMinutes` were both NaN, and the estimate rendered as nothing
 * at all — silently, next to a distance that did appear.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => '/driver/route',
}));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RoutePage from '@/app/driver/route/page';

const SETTINGS = {
  urbanSpeedKmph: 18,
  routeStopMinutes: 4,
  noShowMinContactAttempts: 2,
  noShowMinWaitSeconds: 300,
};

const stop = (id: string, lat: number, lng: number) => ({
  id,
  orderNumber: `HM-${id}`,
  status: 'ON_DELIVERY',
  depotId: 'depot-1',
  destinationAddress: `Jl. ${id}`,
  destinationLat: lat,
  destinationLng: lng,
});

beforeEach(() => {
  get.mockImplementation((url: string) => {
    if (url.includes('/driver/settings')) return Promise.resolve(SETTINGS);
    return Promise.resolve({
      items: [stop('a', -6.2, 106.8), stop('b', -6.25, 106.85)],
      total: 2,
    });
  });
});
afterEach(() => vi.clearAllMocks());

describe('CA-4-29 courier route ETA', () => {
  it('asks the courier route for its tuned numbers, not the manager-only schema', async () => {
    render(<RoutePage />);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
    const urls = get.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/deliveries/api/v1/driver/settings'))).toBe(true);
    // `settings/schema` is the call that 403'd for every courier.
    expect(urls.some((u) => u.includes('settings/schema'))).toBe(false);
  });

  it('renders the estimate the screen is built around', async () => {
    render(<RoutePage />);
    await waitFor(() =>
      expect(screen.getByText(/courierFix\.route\.summaryEta:\d+/)).toBeTruthy(),
    );
  });

  it('shows no estimate rather than a made-up one when the numbers cannot be read', async () => {
    // Failing open with a default nobody chose would put a number on a courier's screen
    // that no depot had set. Distance still renders; the estimate does not.
    get.mockImplementation((url: string) =>
      url.includes('/driver/settings')
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ items: [stop('a', -6.2, 106.8)], total: 1 }),
    );
    render(<RoutePage />);
    await waitFor(() => expect(screen.getByText(/courierFix\.route\.summary:/)).toBeTruthy());
    expect(screen.queryByText(/summaryEta/)).toBeNull();
  });
});
