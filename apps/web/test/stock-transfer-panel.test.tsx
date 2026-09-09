// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-54 — stock could not move between depots at all.
 *
 * The only way stock entered a depot was a purchase order to a supplier. A depot with four
 * spare gallons and one two streets away that had run out could do nothing on the system:
 * the transfer everyone already does on a motorbike had no record, so it surfaced as a
 * shortfall in one book and an unexplained surplus in the other.
 *
 * Two steps, because a transfer is not instantaneous — and the screen has to show that
 * middle state, which is the part that used to be invisible in both depots at once.
 */

const { get, post, toast } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toast: vi.fn() }));

const DEPOTS = [
  { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
  { id: 'd-2', code: 'BGR-01', name: 'Bogor' },
];

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), del: vi.fn() },
  // Mirrors the real one: the message is the SECOND argument, so a mock that swallows the
  // status would put "409" on screen instead of the sentence naming the shortfall.
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'KEPALA_DEPOT' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: DEPOTS,
    selected: DEPOTS[0],
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import InventoryPage from '@/app/dashboard/inventory/page';

const LINE = {
  id: 'line-1',
  depotId: 'd-1',
  itemType: 'PRODUK',
  productId: 'p-1',
  label: 'Galon 19L',
  unit: 'galon',
  quantity: 20,
  reserved: 2,
  minimumStock: 5,
  sellPrice: null,
  hidden: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const INCOMING = [
  {
    id: 'trf-1',
    reference: 'TRF-260909-0001',
    fromDepotId: 'd-2',
    toDepotId: 'd-1',
    productId: 'p-1',
    label: 'Galon 19L',
    unit: 'galon',
    quantity: 6,
    status: 'SENT',
    note: null,
    sentBy: 'staff-2',
    sentAt: '2026-09-09T01:00:00.000Z',
    receivedBy: null,
    receivedAt: null,
    cancelReason: null,
  },
];

const OUTGOING = [{ ...INCOMING[0]!, id: 'trf-2', reference: 'TRF-260909-0002', fromDepotId: 'd-1', toDepotId: 'd-2' }];

function serve(over: { incoming?: unknown[]; outgoing?: unknown[] } = {}) {
  get.mockReset().mockImplementation((raw: unknown) => {
    const path = String(raw ?? '');
    if (path.includes('direction=in')) return Promise.resolve(over.incoming ?? INCOMING);
    if (path.includes('direction=out')) return Promise.resolve(over.outgoing ?? OUTGOING);
    if (path.includes('/inventory')) return Promise.resolve([LINE]);
    return Promise.resolve([]);
  });
}

async function openTransfers() {
  render(<InventoryPage />);
  await waitFor(() => expect(screen.getByText('opsFix.view.transfers')).toBeTruthy());
  await userEvent.click(screen.getByRole('button', { name: 'opsFix.view.transfers' }));
}

beforeEach(() => {
  serve();
  post.mockReset().mockResolvedValue({});
  toast.mockReset();
});

describe('CA-2-54 the depot console can move stock between depots', () => {
  it('shows what is on its way in, which is the state that used to be invisible', async () => {
    await openTransfers();

    await waitFor(() => expect(screen.getByText(/TRF-260909-0001/)).toBeTruthy());
    // Both queues carry a line for this product, so the count is what distinguishes them:
    // one arriving, one sent.
    expect(screen.getAllByText(/Galon 19L · 6 galon/)).toHaveLength(2);
  });

  it('receives a transfer, which is what credits this depot', async () => {
    await openTransfers();
    await waitFor(() => expect(screen.getByText(/TRF-260909-0001/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'dashboard.inventory.transferReceive' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/depots/api/v1/stock-transfers/trf-1/receive');
  });

  it('sends stock to another depot, naming the destination and the product', async () => {
    await openTransfers();
    await waitFor(() => expect(screen.getByText(/TRF-260909-0001/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'dashboard.inventory.transferSend' }));
    const [toDepot, product] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(toDepot!, 'd-2');
    await userEvent.selectOptions(product!, 'p-1');
    await userEvent.type(screen.getByText('dashboard.inventory.transferQty').querySelector('input')!, '4');
    const sendButtons = screen.getAllByRole('button', { name: 'dashboard.inventory.transferSend' });
    await userEvent.click(sendButtons[sendButtons.length - 1]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/depots/api/v1/stock-transfers');
    expect(post.mock.calls[0]?.[1]).toEqual({
      fromDepotId: 'd-1',
      toDepotId: 'd-2',
      productId: 'p-1',
      quantity: 4,
    });
  });

  it('offers only what is genuinely sendable — the reserved units are already promised', async () => {
    await openTransfers();
    await waitFor(() => expect(screen.getByText(/TRF-260909-0001/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'dashboard.inventory.transferSend' }));
    // 20 on the shelf, 2 held for orders: the picker says 18, which is what may leave.
    expect(screen.getByText(/Galon 19L \(18 galon\)/)).toBeTruthy();
  });

  it('takes back one that never arrived, with a reason the ledger can read', async () => {
    await openTransfers();
    await waitFor(() => expect(screen.getByText(/TRF-260909-0002/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'dashboard.inventory.transferTakeBack' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/depots/api/v1/stock-transfers/trf-2/cancel');
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      reason: 'dashboard.inventory.transferReturned',
    });
  });

  it('repeats the server’s refusal — which product is short, and by how much', async () => {
    const { ApiError } = await import('@/lib/api');
    post.mockRejectedValue(new ApiError(422, 'Insufficient stock at the fulfilling depot', 'X'));
    await openTransfers();
    await waitFor(() => expect(screen.getByText(/TRF-260909-0001/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'dashboard.inventory.transferReceive' }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]?.[0])).toContain('Insufficient stock');
  });

  it('says so plainly when nothing is moving either way', async () => {
    serve({ incoming: [], outgoing: [] });
    await openTransfers();

    await waitFor(() =>
      expect(screen.getByText('dashboard.inventory.transfersInEmpty')).toBeTruthy(),
    );
    expect(screen.getByText('dashboard.inventory.transfersOutEmpty')).toBeTruthy();
  });
});
