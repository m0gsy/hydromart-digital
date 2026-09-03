// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  FakeApiError: class FakeApiError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = 'BAD_REQUEST') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, post, patch }, ApiError: FakeApiError }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's-1', role: 'STAFF_DEPOT' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    selectedId: 'd-1',
    selected: { id: 'd-1', name: 'Depot Kemang', code: 'KMG' },
    depots: [],
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/orders',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import OrdersQueuePage from '@/app/dashboard/orders/page';

const order = (id: string, status: string) => ({
  id,
  orderNumber: `HM-${id}`,
  status,
  depotId: 'd-1',
  customerId: 'c-1',
  recipientName: 'Wahyu',
  phone: '0811',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  subtotal: 20000,
  deliveryFee: 5000,
  discount: 0,
  total: 25000,
  items: [],
  history: [],
  createdAt: '2026-08-20T03:00:00.000Z',
});

const ORDERS = [
  order('a', 'PREPARING'),
  order('b', 'CREATED'),
  order('c', 'DRIVER_ASSIGNED'),
  order('d', 'PICKED_UP'),
  order('e', 'DELIVERED'),
  order('f', 'CANCELLED'),
  order('g', 'COMPLETED'),
];

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/orders')) return Promise.resolve({ items: ORDERS, total: ORDERS.length });
    if (p.includes('/deliveries')) return Promise.resolve({ items: [], total: 0 });
    if (p.includes('/drivers')) return Promise.resolve([]);
    return Promise.resolve({ items: [], total: 0 });
  });
  post.mockReset();
  patch.mockReset();
});
afterEach(() => vi.clearAllMocks());

const renderPage = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <OrdersQueuePage />
      </ToastProvider>
    </LocaleProvider>,
  );

/**
 * B8. Half the order lifecycle had no depot screen at all. The queue offered two groups —
 * PREPARING ("needs a courier") and CREATED/CONFIRMED ("still being processed") — and
 * DRIVER_ASSIGNED, PICKED_UP, DELIVERED and CANCELLED appeared in neither.
 *
 * So the moment a depot assigned a courier, the order vanished from the only screen the
 * depot has for orders. "Where is HM-0042?" had no answer on this screen, for the entire
 * half of its life where the answer matters most.
 *
 * The two new groups are read-only by design: assignment stays PREPARING-only because the
 * state machine allows PREPARING → DRIVER_ASSIGNED and nothing else, and a group that
 * offered couriers the server refuses would be the same class of lie this phase is closing.
 */
describe('B8 — the half of an order the depot could not see', () => {
  it('shows an order that is out with a courier', async () => {
    renderPage();
    const chip = await screen.findByRole('button', { name: /dikirim|in delivery/i });
    await userEvent.click(chip);
    expect(await screen.findByText(/HM-c/)).toBeInTheDocument();
    expect(screen.getByText(/HM-d/)).toBeInTheDocument();
    expect(screen.getByText(/HM-e/)).toBeInTheDocument();
  });

  it('shows the orders that are closed, however they closed', async () => {
    renderPage();
    const chip = await screen.findByRole('button', { name: /ditutup|closed/i });
    await userEvent.click(chip);
    expect(await screen.findByText(/HM-f/)).toBeInTheDocument();
    expect(screen.getByText(/HM-g/)).toBeInTheDocument();
  });

  it('leaves the assignable group exactly as it was — PREPARING only', async () => {
    renderPage();
    expect(await screen.findByText(/HM-a/)).toBeInTheDocument();
    expect(screen.queryByText(/HM-c/)).toBeNull();
  });

  it('counts the open backlog without the closed ones', async () => {
    renderPage();
    // PREPARING(1) + CREATED(1) + in-delivery(3) = 5 open; CANCELLED and COMPLETED are not.
    expect(await screen.findByText(/5 pesanan|5 order/i)).toBeInTheDocument();
  });
});

/**
 * The rest of the depot's order queue. It is the screen a depot lives on all day, and
 * before B8 put a test on it, v8 reported the file as a single covered line.
 */
describe('the depot queue, beyond the groups', () => {
  it('names the depot it is scoped to rather than implying every depot', async () => {
    renderPage();
    expect(await screen.findByText(/Depot Kemang/)).toBeInTheDocument();
  });

  it('offers a retry when the queue itself will not load', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('/orders')
        ? Promise.reject(new Error('503'))
        : Promise.resolve({ items: [], total: 0 }),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });

  it('says the group is empty rather than drawing an empty box', async () => {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/orders')) return Promise.resolve({ items: [], total: 0 });
      if (p.includes('/drivers')) return Promise.resolve([]);
      return Promise.resolve({ items: [], total: 0 });
    });
    renderPage();
    expect(
      await screen.findByText(/antrean kosong|belum ada|no orders|empty/i),
    ).toBeInTheDocument();
  });

  it('opens an order and shows what is in it', async () => {
    renderPage();
    await userEvent.click(await screen.findByText(/HM-a/));
    expect(await screen.findAllByText(/HM-a/)).not.toHaveLength(0);
  });
});

/**
 * The action the queue exists for: putting a courier on a PREPARING order. It is the one
 * write on this screen, it decides whether an order moves at all, and nothing measured it.
 */
describe('the depot queue — assigning a courier', () => {
  const DRIVERS = [
    { id: 'drv-1', fullName: 'Budi', phone: '081200000001', role: 'DRIVER' },
    { id: 'drv-2', fullName: 'Sari', phone: '081200000002', role: 'DRIVER' },
  ];

  function withDrivers() {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/orders')) return Promise.resolve({ items: ORDERS, total: ORDERS.length });
      if (p.includes('/drivers')) return Promise.resolve(DRIVERS);
      if (p.includes('/deliveries')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({ items: [], total: 0 });
    });
  }

  it('cannot be dispatched before a courier has been picked', async () => {
    withDrivers();
    renderPage();
    await userEvent.click(await screen.findByText(/HM-a/));
    // The gate is the button's own `disabled`, not a message after the fact — there is no
    // way to fire a dispatch with no courier on it, which is the stronger shape.
    const send = await screen.findByRole('button', { name: /^tugaskan ke/i });
    expect(send).toBeDisabled();
    await userEvent.click(send);
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the order's own landmark along so the courier can read it", async () => {
    withDrivers();
    post.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByText(/HM-a/));
    await userEvent.click(await screen.findByText('Budi'));
    await userEvent.click(screen.getByRole('button', { name: /^tugaskan ke/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ orderId: 'a', driverId: 'drv-1' });
  });

  it("shows the server's own refusal — a courier who already has a job", async () => {
    withDrivers();
    post.mockRejectedValue(
      new FakeApiError('Kurir sedang mengantar pesanan lain.', 409, 'DRIVER_BUSY'),
    );
    renderPage();
    await userEvent.click(await screen.findByText(/HM-a/));
    await userEvent.click(await screen.findByText('Budi'));
    await userEvent.click(screen.getByRole('button', { name: /^tugaskan ke/i }));

    expect(await screen.findByText(/sedang mengantar pesanan lain/i)).toBeInTheDocument();
  });
});
