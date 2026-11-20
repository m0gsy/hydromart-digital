// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 6b: the decision pushes open their queue on the item they are about — a courier's
 * expense claim (EXPENSE_CLAIM_SUBMITTED) and the cash a courier handed in
 * (COURIER_SETTLEMENT_SUBMITTED) — scrolled into view and marked, through `?id=`.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Satu', code: 'D1' }],
    selected: { id: 'd1', name: 'Depot Satu', code: 'D1' },
    selectedId: 'd1',
    scopedId: 'd1',
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import ExpenseClaimsPage from '@/app/dashboard/expense-claims/page';
import SettlementsPage from '@/app/dashboard/settlements/page';

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as never;
});
afterEach(() => {
  get.mockReset();
  window.history.replaceState(null, '', '/');
});

const claim = (id: string) => ({
  id,
  courierId: 'k-1',
  depotId: 'd1',
  category: 'FUEL',
  amount: 90000,
  description: 'Bensin',
  receiptUrl: null,
  status: 'PENDING',
  createdAt: '2026-11-20T01:00:00.000Z',
});
const settlement = (id: string) => ({
  id,
  shiftId: 's-1',
  driverId: 'k-1',
  depotId: 'd1',
  orderIds: [],
  expectedAmount: 150000,
  depositedAmount: 145000,
  variance: -5000,
  status: 'SUBMITTED',
  createdAt: '2026-11-20T01:00:00.000Z',
});

describe('a decision push lands on its item', () => {
  it('an expense-claim push marks that claim in the queue', async () => {
    get.mockImplementation(async (url: string) =>
      url.includes('expense') ? { items: [claim('c-1'), claim('c-2')], total: 2, page: 1, limit: 50 } : [],
    );
    window.history.replaceState(null, '', '/dashboard/expense-claims?id=c-2');
    render(<ExpenseClaimsPage />);
    await waitFor(() => expect(scrolled).toEqual(['row-c-2']));
    expect(document.getElementById('row-c-2')?.getAttribute('aria-current')).toBe('true');
    expect(document.getElementById('row-c-1')?.getAttribute('aria-current')).toBeNull();
  });

  it('a settlement push marks that cash in the list', async () => {
    get.mockImplementation(async (url: string) =>
      url.includes('settlements') ? [settlement('st-1'), settlement('st-2')] : url.includes('rules') ? { surplusNoteThresholdIdr: 0 } : [],
    );
    window.history.replaceState(null, '', '/dashboard/settlements?id=st-1');
    render(<SettlementsPage />);
    await waitFor(() => expect(scrolled).toEqual(['row-st-1']));
    expect(document.getElementById('row-st-1')?.getAttribute('aria-current')).toBe('true');
  });
});
