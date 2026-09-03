// @vitest-environment jsdom
//
// PAR-04. `GET /rewards/items`, `POST /rewards/items` and `PATCH /rewards/items/:id` were
// all built for design 15c — the controller's own comment says they exist so the table
// would stop needing SQL — and no screen called any of them. So the reward catalogue was
// still SQL-only, and nobody noticed because the customer-facing `/rewards/catalog` read
// worked fine.
//
// Three things this screen has to get right:
//
//   1. read `items`, not `catalog`. `catalog` returns active rows only, and a retired
//      reward you cannot see is a retired reward you cannot bring back.
//   2. retire and restore are the SAME PATCH, flipping `active` — one write path, not two.
//   3. blank stock means UNLIMITED, and must be sent as null. Sending 0 would create a
//      reward that is sold out the moment it exists.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, patch, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  toast: vi.fn(),
}));

const ITEMS = [
  {
    id: 'r1',
    name: 'Isi Ulang Galon 19L',
    unit: 'gratis 1 galon',
    pointsCost: 800,
    imageUrl: null,
    stock: 5,
    active: true,
  },
  {
    id: 'r2',
    name: 'Tumbler Hydromart',
    unit: '1 buah',
    pointsCost: 2000,
    imageUrl: null,
    stock: 0,
    active: false,
  },
];

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/loyalty-rules', () => ({ useLoyaltyRules: () => ({ data: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/loyalty',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqLoyaltyPage from '@/app/hq/loyalty/page';

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  getCached.mockReset().mockResolvedValue([]);
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/rewards/items')) return Promise.resolve(ITEMS);
    if (p.includes('/loyalty/tiers')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

afterEach(() => vi.clearAllMocks());

const open = () => {
  const user = userEvent.setup();
  render(<HqLoyaltyPage />, { wrapper: LocaleProvider });
  return user;
};

describe('/hq/loyalty · reward catalogue management (PAR-04)', () => {
  it('reads the management list, so retired rewards are visible at all', async () => {
    open();
    expect(await screen.findByText('Isi Ulang Galon 19L')).toBeTruthy();
    // The retired one. `/rewards/catalog` would never have returned it.
    expect(await screen.findByText('Tumbler Hydromart')).toBeTruthy();
    expect(await screen.findByText('Pensiun')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/rewards/items'))).toBe(true);
    expect(get.mock.calls.some((c) => String(c[0]).includes('/rewards/catalog'))).toBe(false);
  });

  it('retires an active reward by patching active:false', async () => {
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Pensiunkan' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(String(patch.mock.calls[0]![0])).toContain('r1');
    expect(patch.mock.calls[0]![1]).toEqual({ active: false });
  });

  it('restores a retired reward through the same call', async () => {
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Aktifkan lagi' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(String(patch.mock.calls[0]![0])).toContain('r2');
    expect(patch.mock.calls[0]![1]).toEqual({ active: true });
  });

  it('will not add a reward until it has a name, a unit and a positive cost', async () => {
    const user = open();
    const add = await screen.findByRole('button', { name: 'Tambah hadiah' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Nama hadiah'), 'Voucher Rp10.000');
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Satuan'), '1 voucher');
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Poin'), '500');
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  });

  it('sends blank stock as null — unlimited, not sold out', async () => {
    const user = open();
    await user.type(await screen.findByLabelText('Nama hadiah'), 'Voucher Rp10.000');
    await user.type(screen.getByLabelText('Satuan'), '1 voucher');
    await user.type(screen.getByLabelText('Poin'), '500');
    await user.click(screen.getByRole('button', { name: 'Tambah hadiah' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({
      name: 'Voucher Rp10.000',
      unit: '1 voucher',
      pointsCost: 500,
      stock: null,
    });
  });
});
