// @vitest-environment jsdom
/**
 * P1a — the courier's Navigasi button on a delivery with no map pin.
 *
 * A counter sale and an imported address carry no coordinates, and the link was built as
 * `?q=${lat ?? ''},${lng ?? ''}` — so it opened Maps on `?q=,`, which is nowhere. Without a
 * pin it now searches the address the courier is reading.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, patch: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'drv-1', role: 'DRIVER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'del-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/deliveries/detail',
  useSearchParams: () => new URLSearchParams('id=del-1'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import DeliveryDetailPage from '@/app/driver/deliveries/detail/page';

function mount(pin: { lat: number; lng: number } | null) {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/deliveries/del-1')) {
      return Promise.resolve({
        id: 'del-1',
        orderId: 'ord-1',
        orderNumber: 'HM-1001',
        status: 'ASSIGNED',
        driverId: 'drv-1',
        recipientPhone: '081234567890',
        destinationAddress: 'Jl. Mawar 1 No. 5, Bandung',
        destinationLat: pin?.lat ?? null,
        destinationLng: pin?.lng ?? null,
        codAmount: 0,
        assignedAt: '2026-08-22T01:00:00.000Z',
      });
    }
    if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve(null);
  });
  return render(<DeliveryDetailPage />, { wrapper: LocaleProvider });
}

afterEach(() => vi.clearAllMocks());

describe('Navigasi', () => {
  it('searches the address when the delivery has no pin', async () => {
    mount(null);
    const link = await screen.findByRole('link', { name: /navigasi/i });
    expect(link.getAttribute('href')).toBe(
      `https://maps.google.com/?q=${encodeURIComponent('Jl. Mawar 1 No. 5, Bandung')}`,
    );
  });

  it('goes to the pin when there is one', async () => {
    mount({ lat: -6.9147, lng: 107.6098 });
    const link = await screen.findByRole('link', { name: /navigasi/i });
    expect(link.getAttribute('href')).toBe('https://maps.google.com/?q=-6.9147,107.6098');
  });
});
