// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, push } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), push: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, patch } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'drv-1', role: 'DRIVER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'del-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/deliveries/detail',
  useSearchParams: () => new URLSearchParams('id=del-1'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import DeliveryDetailPage from '@/app/driver/deliveries/detail/page';

const delivery = (status: string) => ({
  id: 'del-1',
  orderId: 'ord-1',
  orderNumber: 'HM-1001',
  status,
  driverId: 'drv-1',
  recipientName: 'Wahyu',
  recipientPhone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  codAmount: 0,
  destinationLat: null,
  destinationLng: null,
  assignedAt: '2026-08-22T01:00:00.000Z',
});

function mount(status: string) {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/deliveries/del-1')) return Promise.resolve(delivery(status));
    if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve(null);
  });
  return render(<DeliveryDetailPage />, { wrapper: LocaleProvider });
}

beforeEach(() => {
  patch.mockReset();
  push.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * B9. The domain has allowed FAILED and RESCHEDULED from ASSIGNED and PICKED_UP since the
 * state machine was written (`delivery-status.ts` TRANSITIONS). The courier screen offered
 * them only at ON_DELIVERY, because the whole three-button row lived inside that branch.
 *
 * So a courier who arrives at the depot and finds the stock is not there can do exactly
 * nothing: not fail it, not reschedule it. The delivery sits ASSIGNED, holding a stock
 * reservation and a courier's slot, until somebody at a desk notices.
 *
 * No-show is the exception and stays at ON_DELIVERY: a customer cannot fail to be home
 * before the courier has set off for their home.
 */
describe('B9 — the failure window the courier screen kept shut', () => {
  it.each(['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'])(
    'offers fail and reschedule at %s, as the domain always did',
    async (status) => {
      mount(status);
      expect(await screen.findByRole('button', { name: /gagal/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /jadwal ulang|reschedule/i })).toBeInTheDocument();
    },
  );

  it('keeps no-show at ON_DELIVERY only — nobody can be out before you set off', async () => {
    mount('ON_DELIVERY');
    expect(
      await screen.findByRole('button', { name: /tidak di tempat|no.?show/i }),
    ).toBeInTheDocument();
  });

  it.each(['ASSIGNED', 'PICKED_UP'])('offers no no-show at %s', async (status) => {
    mount(status);
    await screen.findByRole('button', { name: /gagal/i });
    expect(screen.queryByRole('button', { name: /tidak di tempat|no.?show/i })).toBeNull();
  });

  it('offers neither once the delivery is already closed', async () => {
    mount('DELIVERED');
    await screen.findByText(/HM-1001/);
    expect(screen.queryByRole('button', { name: /gagal/i })).toBeNull();
  });
});

/**
 * The rest of what this screen does. It is the courier's whole job — pick up, set off,
 * arrive, take cash, hand back empties — and before B9 put a test on it, v8 reported the
 * file as a single covered line.
 */
describe('the courier screen, step by step', () => {
  it('confirms pickup at ASSIGNED, and that is the only action offered', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    patch.mockResolvedValue({});
    mount('ASSIGNED');

    const pickup = await screen.findByRole('button', { name: /barang diambil|picked up/i });
    expect(screen.queryByRole('button', { name: /mulai antar|start/i })).toBeNull();
    await userEvent.click(pickup);
    expect(String(patch.mock.calls[0]?.[0])).toContain('/pickup');
  });

  it('offers "set off" once the goods are on board', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    patch.mockResolvedValue({});
    mount('PICKED_UP');

    const start = await screen.findByRole('button', { name: /mulai|start|antar/i });
    await userEvent.click(start);
    expect(String(patch.mock.calls[0]?.[0])).toContain('/start');
  });

  it('opens the returns flow from the delivery itself', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    mount('ON_DELIVERY');

    await userEvent.click(
      await screen.findByRole('button', { name: /galon kosong|empties|retur/i }),
    );
    expect(String(push.mock.calls.at(-1)?.[0])).toContain('/returns');
  });

  it('says what went wrong instead of a blank screen when the delivery will not load', async () => {
    get.mockReset().mockRejectedValue(new Error('boom'));
    render(<DeliveryDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });
});

/**
 * B5b. The customer picks a delivery window at checkout and is shown a confirmation of it.
 * order-service stored it, its own response DTO returned it, and it reached nobody — least
 * of all the person whose day it governs, standing at the door with the box.
 *
 * B5a snapshotted it onto the delivery at assignment. This is the screen that reads it.
 */
describe('B5b — the window on the screen of the person carrying the box', () => {
  it('shows the window the customer chose', async () => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/deliveries/del-1')) {
        return Promise.resolve({
          ...delivery('ON_DELIVERY'),
          deliveryWindow: '2026-08-22 09:00-12:00',
        });
      }
      if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve(null);
    });
    render(<DeliveryDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(/09:00-12:00/)).toBeInTheDocument();
  });

  it('says nothing rather than inventing one for a delivery that carried none', async () => {
    mount('ON_DELIVERY');
    await screen.findByText(/HM-1001/);
    expect(screen.queryByText(/09:00-12:00/)).toBeNull();
  });

  it('shows it beside the landmark — one did not replace the other', async () => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/deliveries/del-1')) {
        return Promise.resolve({
          ...delivery('ON_DELIVERY'),
          deliveryWindow: '2026-08-22 09:00-12:00',
          notes: 'Pagar hijau sebelah warung Bu Ani',
        });
      }
      if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve(null);
    });
    render(<DeliveryDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(/09:00-12:00/)).toBeInTheDocument();
    expect(screen.getByText(/Pagar hijau sebelah warung Bu Ani/)).toBeInTheDocument();
  });
});
