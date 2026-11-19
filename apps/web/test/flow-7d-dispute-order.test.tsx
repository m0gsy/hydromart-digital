// @vitest-environment jsdom
/**
 * Flow plan PR-7d · a dispute is recorded against an order the form found.
 *
 * The form asked for the order number, the customer's name and the courier's name as three
 * free-text boxes: staff retyped from another screen, and a typo filed the dispute under an
 * order that did not exist. The number box now searches the depot's orders and a pick fills
 * the other two. The order panel opens the form already filled, for that order's depot.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, replace, who, query, depot } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  replace: vi.fn(),
  who: { role: 'KEPALA_DEPOT' },
  query: { params: {} as Record<string, string> },
  depot: { scopedId: 'd-1' as string | null },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', name: 'Depot Satu' }],
    selected: null,
    selectedId: depot.scopedId,
    scopedId: depot.scopedId,
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: (k: string) => query.params[k] ?? null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/disputes',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { ConfirmProvider } from '@/components/confirm';
import DisputesPage from '@/app/dashboard/disputes/page';
import { OrderDetail } from '@/components/dashboard/order-detail';

const OID = '7b0c2a51-3f4e-4d6a-9b1c-2e8f0a9d4c11';
const ORDER = {
  id: OID,
  orderNumber: 'HM-261119-007',
  status: 'DELIVERED',
  depotId: 'd-1',
  recipientName: 'Rina Hapsari',
  phone: '0811',
  deliveryAddress: 'Jl. Dua',
  driverName: 'Budi Santoso',
  items: [],
  history: [],
  subtotal: 0,
  deliveryFee: 0,
  discount: 0,
  total: 40_000,
  createdAt: '2026-11-19T02:00:00.000Z',
};

beforeEach(() => {
  who.role = 'KEPALA_DEPOT';
  query.params = {};
  depot.scopedId = 'd-1';
  post.mockReset().mockResolvedValue({});
  replace.mockReset();
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes(`/orders/api/v1/orders/manage/${OID}`)) return ORDER;
    if (path.includes('/orders/api/v1/orders/manage')) return { items: [ORDER], total: 1, page: 1, limit: 5 };
    if (path.includes('order-disputes')) return [];
    return { items: [] };
  });
});
afterEach(() => vi.clearAllMocks());

const draw = (ui: React.ReactElement) =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('the order number searches, and a pick fills the names', () => {
  it('finds the order in this depot and fills the customer and the courier', async () => {
    draw(<DisputesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catat sengketa' }));
    fireEvent.change(field(/Nomor order/), { target: { value: 'HM-261119' } });

    const pick = await screen.findByRole('button', { name: /HM-261119-007/ });
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/orders\/manage\?.*orderNumber=HM-261119.*depotId=d-1|orders\/manage\?.*depotId=d-1.*orderNumber=HM-261119/), true);
    fireEvent.click(pick);

    expect(field(/Nomor order/).value).toBe('HM-261119-007');
    expect(field(/Nama pelanggan/).value).toBe('Rina Hapsari');
    expect(field(/Kurir/).value).toBe('Budi Santoso');
  });

  it('a search that fails costs nothing: the boxes still take typing', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('order-disputes')) return [];
      throw new Error('403');
    });
    draw(<DisputesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catat sengketa' }));
    fireEvent.change(field(/Nomor order/), { target: { value: 'HM-9' } });
    fireEvent.change(field(/Nama pelanggan/), { target: { value: 'Ani' } });
    expect(field(/Nomor order/).value).toBe('HM-9');
    expect(field(/Nama pelanggan/).value).toBe('Ani');
  });
});

describe('opened from the order panel', () => {
  it('?order= opens the form filled; saved, the link is dropped', async () => {
    query.params = { order: OID };
    draw(<DisputesPage />);
    await waitFor(() => expect(field(/Nomor order/).value).toBe('HM-261119-007'));
    expect(field(/Nama pelanggan/).value).toBe('Rina Hapsari');
    fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Galon bocor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan sengketa' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      depotId: 'd-1',
      orderRef: 'HM-261119-007',
      customerName: 'Rina Hapsari',
      courierName: 'Budi Santoso',
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/disputes'));
  });

  it('an order of another depot is refused, not filed where this list never shows it', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes(`/orders/api/v1/orders/manage/${OID}`)) return { ...ORDER, depotId: 'd-2' };
      return [];
    });
    query.params = { order: OID };
    draw(<DisputesPage />);
    expect(await screen.findByText(/milik depot lain/)).toBeTruthy();
    expect(field(/Nomor order/).value).toBe('');
  });

  it('a link that is not an order id asks nothing', async () => {
    query.params = { order: '../../customers/api/v1/x' };
    draw(<DisputesPage />);
    await screen.findByLabelText(/Nomor order/);
    expect(get.mock.calls.some((c) => String(c[0]).includes('customers'))).toBe(false);
  });

  it('the order panel links there for a role that records disputes', async () => {
    draw(<OrderDetail order={ORDER as never} onClose={() => {}} onChanged={() => {}} />);
    const link = await screen.findByRole('link', { name: /Catat sengketa/ });
    expect(link.getAttribute('href')).toBe(`/dashboard/disputes?order=${OID}`);
  });

  it('nor for an order of a depot this console is not showing', async () => {
    draw(<OrderDetail order={{ ...ORDER, depotId: 'd-2' } as never} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('HM-261119-007');
    expect(screen.queryByRole('link', { name: /Catat sengketa/ })).toBeNull();
  });

  it('and not for one that does not', async () => {
    who.role = 'STAFF_DEPOT';
    draw(<OrderDetail order={ORDER as never} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('HM-261119-007');
    expect(screen.queryByRole('link', { name: /Catat sengketa/ })).toBeNull();
  });
});
