// @vitest-environment jsdom
/*
 * K3.5 · the till lists ONE page of the global catalogue — `products.browse({limit:100})`
 * ordered `createdAt desc` — and then filters it by what the depot stocks. The moment the
 * network catalogue passes 100 active products, the oldest SKUs fall off the page before
 * the filter ever sees them: AIR-GALON-19L, the product the business is, goes first, and
 * the screen says "this depot has nothing in stock" while the depot is full of it.
 *
 * K3.6 · the cash column hides how much is missing. `Math.max(0, change)` clamps a short
 * payment to "Rp 0" in red, so the one number the cashier needs — how much more to ask
 * for — is the one number the screen refuses to show. And this is the only cash-taking
 * screen in the app that neither sanitises what is typed nor offers the notes the courier
 * screen offers.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/walk-in',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'depot-1' }, ready: true }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch } };
});
vi.mock('@/lib/receipt', () => ({ printReceipt: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', ready: true, error: null, reload: vi.fn(), depots: [] }),
}));
vi.mock('@/lib/roles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return { ...actual, canRecordWalkInSale: () => true };
});

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const product = (id: string, name: string, price = 20000) => ({
  id,
  name,
  basePrice: price,
  unit: 'Galon',
  isGallon: true,
  imageUrl: null,
  categoryId: null,
});

/** The founding SKU, and — ordered newest-first — the first one to fall off page one. */
const OLDEST = product('p-air', 'Air Galon 19L');
/** 100 newer accessories: exactly what a grown network catalogue looks like. */
const NEWER = Array.from({ length: 100 }, (_, i) => product(`p-${i}`, `Aksesori ${i}`, 5000));

let browseCalls: string[] = [];
let batchBody: unknown = null;

beforeEach(() => {
  browseCalls = [];
  batchBody = null;
  post.mockReset().mockImplementation(async (path: string, body: unknown) => {
    if (path.includes('/walk-in/quote')) {
      return { subtotalIdr: 20000, discountIdr: 0, totalIdr: 20000, agen: false, catalogFallback: null };
    }
    if (path.includes('/products/batch')) {
      batchBody = body;
      return [OLDEST];
    }
    return {};
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    // K3.3: the pay button now waits for the shift read instead of assuming a shift is
    // open while it is in flight. These cases are about what happens AFTER the cashier
    // presses Bayar, so the shift has to answer.
    if (p.includes('shift')) {
      return { id: 's-1', depotId: 'depot-1', cashierId: 's1', cashierName: 'Rina', status: 'OPEN', openingFloat: 0, openedAt: '2026-08-25T08:00:00.000Z', closedAt: null, countedCash: null, expectedCash: null, variance: null, note: null };
    }
    // The depot stocks exactly one product: the oldest one in the network catalogue.
    if (p.includes('/inventory')) {
      return [{ id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 }];
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/products/batch')) {
      batchBody = p;
      return [OLDEST];
    }
    if (p.includes('/products')) {
      browseCalls.push(p);
      // Page one, newest first — the founding SKU is not on it.
      return { items: NEWER, total: 101, page: 1, limit: 100 };
    }
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe('K3.5 · the till sells what the depot stocks, not what fits on page one', () => {
  it('lists a stocked product that page one of the catalogue does not carry', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
  });

  it('asks for the stocked ids by name instead of paging the whole catalogue', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
    expect(JSON.stringify(batchBody ?? '')).toContain('p-air');
    expect(browseCalls).toHaveLength(0);
  });
});

describe('K3.6 · the cash column says how much is missing', () => {
  it('names the shortfall instead of showing Rp 0', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
    await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
    await waitFor(() => expect(screen.getByLabelText(/uang tunai diterima/i)).toBeTruthy());
    await userEvent.type(screen.getByLabelText(/uang tunai diterima/i), '15000');
    // 20.000 due, 15.000 handed over: the screen must say 5.000 short, not "Rp 0".
    await waitFor(() => expect(screen.getAllByText(/kurang/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/5\.000/).length).toBeGreaterThan(0);
  });

  it('strips what is not a digit as it is typed, like every other cash screen', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
    await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
    const field = (await screen.findByLabelText(/uang tunai diterima/i)) as HTMLInputElement;
    await userEvent.type(field, '20.0o0x0');
    expect(field.value).toBe('20000');
  });

  it('offers exact money and the notes above the total, like the courier screen', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
    await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
    await waitFor(() => expect(screen.getByLabelText(/uang tunai diterima/i)).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /uang pas/i }));
    expect((screen.getByLabelText(/uang tunai diterima/i) as HTMLInputElement).value).toBe('20000');
    // A note smaller than the bill is not a note anybody hands over.
    expect(screen.queryByRole('button', { name: '10.000' })).toBeNull();
    expect(screen.getByRole('button', { name: '50.000' })).toBeTruthy();
  });
});
