// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-1d of the flow plan: rows that did nothing, buttons for writes the reader is refused,
 * a working screen nothing linked to, and two phone tabs with one name.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const who = { role: 'SUPER_ADMIN', path: '/dashboard' };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  getBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    locale: 'id',
    setLocale: vi.fn(),
  }),
  useLocale: () => ({ locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Uji', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: async () => true, askReason: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => who.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    selectedId: 'd-1',
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));
vi.mock('@/lib/unread', () => ({ useUnreadCount: () => 0, useOpsUnreadCount: () => 0 }));

import DepotAccountPage from '@/app/dashboard/account/page';
import ReportsPage from '@/app/dashboard/reports/page';
import HqPromotionsPage from '@/app/hq/promotions/page';
import HqStaffPage from '@/app/hq/staff/page';
import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';

const hrefOf = (text: string) => screen.queryByText(text)?.closest('a')?.getAttribute('href') ?? null;

beforeEach(() => {
  who.role = 'SUPER_ADMIN';
  who.path = '/dashboard';
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('the staff account screen', () => {
  it('no longer lists a PIN row and a devices row that do nothing', async () => {
    who.role = 'MANAGER';
    render(<DepotAccountPage />);
    await waitFor(() => expect(document.body.textContent).toContain('dashA'));
    expect(screen.queryByText('dashA.account.pin.label')).toBeNull();
    expect(screen.queryByText('dashA.account.devices.label')).toBeNull();
  });
});

describe('head-office banners are written by whoever holds promotionWrite only', () => {
  beforeEach(() => {
    get.mockImplementation(async () => [
      { id: 'p1', title: 'Banner A', subtitle: null, active: true, sortOrder: 1 },
    ]);
  });

  it('head office reads them, with no new, edit or delete', async () => {
    who.role = 'HEAD_OFFICE';
    render(<HqPromotionsPage />);
    await waitFor(() => expect(screen.getByText('Banner A')).toBeTruthy());
    expect(screen.queryByText('hq.promotions.newBanner')).toBeNull();
    expect(screen.queryByText('hq.promotions.edit')).toBeNull();
    expect(screen.queryByText('hq.promotions.remove')).toBeNull();
  });

  it('the super admin still writes them', async () => {
    render(<HqPromotionsPage />);
    await waitFor(() => expect(screen.getByText('Banner A')).toBeTruthy());
    expect(screen.getByText('hq.promotions.newBanner')).toBeTruthy();
    expect(screen.getByText('hq.promotions.edit')).toBeTruthy();
    expect(screen.getByText('hq.promotions.remove')).toBeTruthy();
  });
});

describe('the staff list links its own import', () => {
  it('offers "Impor staf" to a role that may write staff', async () => {
    who.role = 'HEAD_OFFICE';
    get.mockImplementation(async () => ({ items: [], total: 0, page: 1, limit: 50 }));
    render(<HqStaffPage />);
    await waitFor(() => expect(screen.getByText('hq.nav.staffImport')).toBeTruthy());
    expect(hrefOf('hq.nav.staffImport')).toBe('/hq/staff/import');
  });
});

describe('the sales-history import has a door', () => {
  // The report bodies are not under test; an empty day keeps them quiet.
  const emptyDay = {
    orders: 0,
    revenueIdr: 0,
    codCollectedIdr: 0,
    failedDeliveries: 0,
    gallonsDamaged: 0,
    gallonsDelivered: 0,
    gallonsReturned: 0,
    avgPerDayIdr: 0,
    slaOnTimePct: null,
    byHour: [],
    perCashier: [],
    perCourier: [],
    refillSplit: { refill: 0, partial: 0, beli: 0 },
    revenueByDay: [],
    topCourier: null,
    topProducts: [],
  };
  beforeEach(() => get.mockImplementation(async () => emptyDay));

  it('is linked from the depot report for a role that may import', async () => {
    who.role = 'MANAGER';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('hrFix.imports.salesHistory')).toBeTruthy());
    expect(hrefOf('hrFix.imports.salesHistory')).toBe('/dashboard/sales-import');
  });

  it('is not offered to the depot head, who may not (salesImportAdmin)', async () => {
    who.role = 'KEPALA_DEPOT';
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('opsFix.reports.tabDaily')).toBeTruthy());
    expect(screen.queryByText('hrFix.imports.salesHistory')).toBeNull();
  });
});

describe('the phone bar names its two summaries apart', () => {
  it('a role with both sees "my franchise" and "summary", not "summary" twice', () => {
    render(<OpsBottomNav />);
    expect(screen.getAllByText('hrFix.opsNav.summary')).toHaveLength(1);
    expect(screen.getByText('ops.nav.myFranchise')).toBeTruthy();
  });
});
