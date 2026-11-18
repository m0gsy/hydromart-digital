// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-1c of the flow plan: three shortcuts that dropped the reader one step short.
 * - "Buat pesanan" on a customer opened the order QUEUE, where no order can be created;
 *   the till can, and it now arrives with the customer's number in it.
 * - Every "low stock" door opened the full inventory (or, on the manager's phone, the
 *   notification feed) instead of the low lines.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const who = { role: 'MANAGER' };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  getBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
  useLocale: () => ({ locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, assignedDepotId: 'd-1' },
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
  usePathname: () => '/dashboard',
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

import CustomerDetailPage from '@/app/dashboard/customers/detail/page';
import InventoryPage from '@/app/dashboard/inventory/page';
import DashboardPage from '@/app/dashboard/page';
import ManagerHome from '@/app/m/manager/page';

const hrefOf = (text: string) => screen.queryByText(text)?.closest('a')?.getAttribute('href') ?? null;

beforeEach(() => {
  who.role = 'MANAGER';
  window.history.replaceState({}, '', '/');
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('"Buat pesanan" on a customer', () => {
  const detail = {
    profile: {
      fullName: 'Budi',
      phone: '081234567890',
      isSubscriber: false,
      orderCount: 2,
      totalSpentIdr: 40000,
      gallonsOnLoan: 0,
      overdueGallons: 0,
      oldestGallonAt: null,
      churnRisk: null,
    },
    addresses: [],
    depositLedger: [],
    recentOrders: [],
  };

  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard/customers/detail?id=c1');
    get.mockImplementation(async (url: string) => {
      if (String(url).includes('/depot-detail')) return detail;
      throw new Error('not under test');
    });
  });

  it('opens the till with the customer already on it, for a role that sells at the counter', async () => {
    render(<CustomerDetailPage />);
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(hrefOf('dashA.customerDetail.createOrder')).toBe('/dashboard/walk-in?phone=081234567890');
  });

  it('is not offered to a role that cannot sell (HR reads the directory only)', async () => {
    who.role = 'HR';
    render(<CustomerDetailPage />);
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(screen.queryByText('dashA.customerDetail.createOrder')).toBeNull();
  });
});

describe('low stock doors land on the low lines', () => {
  it('the inventory screen starts on "low only" when sent ?low=1', async () => {
    window.history.replaceState({}, '', '/dashboard/inventory?low=1');
    render(<InventoryPage />);
    const chip = await waitFor(() => {
      const el = screen.getByText(/opsFix\.inv\.filterLow/).closest('button');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('and starts on everything without it', async () => {
    window.history.replaceState({}, '', '/dashboard/inventory');
    render(<InventoryPage />);
    const chip = await waitFor(() => screen.getByText(/opsFix\.inv\.filterLow/).closest('button')!);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it("the depot home's low-stock card opens the low lines", async () => {
    get.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/inventory'))
        return [{ id: 'i1', label: 'Galon 19L', available: 1, unit: 'galon', minimumStock: 5 }];
      if (u.includes('/approvals/') || u.includes('/deliveries/')) return [];
      return {
        sales: { buckets: [] },
        deliverySla: { totalDelivered: 0, onTime: 0, onTimeRate: 0 },
        topCustomers: { items: [] },
        sources: { order: 'ok', delivery: 'ok' },
        topDepots: { items: [] },
      };
    });
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
    expect(hrefOf('dashboard.landing.lowStock.viewAll')).toBe('/dashboard/inventory?low=1');
  });

  it("the manager phone's critical-stock tile opens the low lines, not the notification feed", async () => {
    render(<ManagerHome />);
    await waitFor(() => expect(screen.getByText('mgrFix.mMgr.stockCritical')).toBeTruthy());
    expect(hrefOf('mgrFix.mMgr.stockCritical')).toBe('/dashboard/inventory?low=1');
  });
});
