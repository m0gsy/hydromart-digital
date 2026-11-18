// @vitest-environment jsdom
/*
 * PR-1c: "Buat pesanan" on a customer opens the till with `?phone=`. The till reads it once,
 * as the buyer's number, so the cashier starts from the customer they were looking at
 * instead of retyping it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/walk-in',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'depot-1' },
    ready: true,
  }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch } };
});
vi.mock('@/lib/receipt', () => ({ printReceipt: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', ready: true, error: null, reload: vi.fn(), depots: [] }),
}));

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

beforeEach(() => {
  post.mockReset().mockResolvedValue({ subtotalIdr: 0, discountIdr: 0, totalIdr: 0, agen: false });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('shift')) {
      return {
        id: 's-1',
        depotId: 'depot-1',
        cashierId: 's1',
        cashierName: 'Rina',
        status: 'OPEN',
        openingFloat: 0,
        openedAt: '2026-08-25T08:00:00.000Z',
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
        note: null,
      };
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/products')) return { items: [], total: 0, page: 1, limit: 100 };
    return [];
  });
});
afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('the till reads the customer it was sent', () => {
  it('starts with the buyer number from ?phone=', async () => {
    window.history.replaceState({}, '', '/dashboard/walk-in?phone=081234567890');
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() =>
      expect((document.getElementById('wi-phone') as HTMLInputElement | null)?.value).toBe(
        '081234567890',
      ),
    );
  });

  it('starts empty without it', async () => {
    window.history.replaceState({}, '', '/dashboard/walk-in');
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(document.getElementById('wi-phone')).toBeTruthy());
    expect((document.getElementById('wi-phone') as HTMLInputElement).value).toBe('');
    expect(screen.queryByDisplayValue('081234567890')).toBeNull();
  });
});
