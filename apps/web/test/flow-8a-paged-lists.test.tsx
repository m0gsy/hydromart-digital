// @vitest-environment jsdom
/**
 * Flow plan PR-8a · four depot-console lists that stopped at a fixed count and said nothing.
 *
 * Each read one page of an endpoint that pages, and drew it as the list: the 101st audit entry,
 * the 51st campaign, the 101st claim waiting for approval, the 101st account did not exist on
 * screen. They walk pages now and say "N dari total", like /hq/audit already did. The staff
 * screen's depot picker reads every depot, not the first 100.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, who } = vi.hoisted(() => ({ get: vi.fn(), who: { role: 'SUPER_ADMIN' } }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
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
vi.mock('@/lib/use-custom-roles', () => ({
  useCustomRoles: () => [],
  useDisabledRoles: () => new Set<string>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import AuditPage from '@/app/dashboard/audit/page';
import ExpenseClaimsPage from '@/app/dashboard/expense-claims/page';
import { CampaignList } from '@/components/campaigns/campaign-list';
import { StaffDirectory } from '@/components/staff/staff-directory';

const TOTAL = 130;

/** A server that pages `route`: rows `make(i)`, `total` 130, honouring ?page and ?limit. */
function pagedServer(route: string, make: (i: number) => Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    const u = new URL(url, 'http://x');
    if (u.pathname.includes('/depots/manage')) {
      const page = Number(u.searchParams.get('page') ?? 1);
      // 150 depots: the first page alone is 100.
      const from = (page - 1) * 100;
      const n = Math.max(0, Math.min(100, 150 - from));
      return { items: Array.from({ length: n }, (_, i) => ({ id: `dp-${from + i}`, name: `Depot ${from + i}` })), total: 150, page, limit: 100 };
    }
    if (u.pathname.includes('/employees')) return { rows: [], total: 0 };
    if (!u.pathname.includes(route)) return { items: [], total: 0 };
    const page = Number(u.searchParams.get('page') ?? 1);
    const limit = Number(u.searchParams.get('limit') ?? 20);
    const from = (page - 1) * limit;
    const n = Math.max(0, Math.min(limit, TOTAL - from));
    return { items: Array.from({ length: n }, (_, i) => make(from + i)), total: TOTAL, page, limit };
  });
}

const pagesAsked = (route: string) =>
  get.mock.calls
    .map((c) => new URL(String(c[0]), 'http://x'))
    .filter((u) => u.pathname.includes(route))
    .map((u) => Number(u.searchParams.get('page') ?? 1));

beforeEach(() => {
  who.role = 'SUPER_ADMIN';
  get.mockReset();
});
afterEach(() => vi.clearAllMocks());

/** The list shows its first page, says how many there are, and reads the next one on ask. */
async function walksPages(route: string) {
  expect(await screen.findByText('common.shownOfTotal')).toBeTruthy();
  expect(pagesAsked(route)).toEqual([1]);
  fireEvent.click(screen.getByRole('button', { name: 'common.loadMore' }));
  await waitFor(() => expect(pagesAsked(route)).toContain(2));
}

describe('lists that page', () => {
  it('the depot audit trail', async () => {
    pagedServer('/audit/depot', (i) => ({ id: `a-${i}`, action: 'stock.receipt', success: true, createdAt: '2026-11-19T01:00:00Z' }));
    render(<AuditPage />);
    await walksPages('/audit/depot');
  });

  it('the campaign list', async () => {
    pagedServer('/crm/api/v1/campaigns', (i) => ({ id: `c-${i}`, name: `Kampanye ${i}`, status: 'SENT', channel: 'PUSH', createdAt: '2026-11-19T01:00:00Z' }));
    render(<CampaignList canManage={false} emptyHint="kosong" />);
    await walksPages('/crm/api/v1/campaigns');
  });

  it('the expense claims waiting for approval', async () => {
    pagedServer('/payout/api/v1/expenses', (i) => ({ id: `e-${i}`, status: 'PENDING', amountIdr: 10_000, category: 'FUEL', createdAt: '2026-11-19T01:00:00Z', claimantName: `Staf ${i}` }));
    render(<ExpenseClaimsPage />);
    await walksPages('/payout/api/v1/expenses');
  });

  it('the staff directory', async () => {
    pagedServer('/auth/api/v1/auth/staff', (i) => ({ id: `s-${i}`, fullName: `Staf ${i}`, phone: `0812${i}`, role: 'STAFF_DEPOT', status: 'ACTIVE', assignedDepotId: 'd1' }));
    render(<StaffDirectory header={() => null} />);
    await walksPages('/auth/api/v1/auth/staff');
  });
});

describe('the staff screen depot picker', () => {
  it('offers every depot, not the first 100', async () => {
    pagedServer('/auth/api/v1/auth/staff', (i) => ({ id: `s-${i}`, fullName: `Staf ${i}`, phone: `0812${i}`, role: 'STAFF_DEPOT', status: 'ACTIVE', assignedDepotId: 'd1' }));
    render(<StaffDirectory header={() => null} />);
    await screen.findByText('common.shownOfTotal');
    await waitFor(() => expect(pagesAsked('/depots/manage')).toEqual([1, 2]));
  });
});
