// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HD-6 A4 — the manager's phone home.
 *
 *  - It asked the executive dashboard for `{depotId}` only, so SLA (and orders, revenue) were
 *    all-time and never moved. It now sends the current WIB month.
 *  - A depot with no delivered order has no rate: `slaRate` is null and the tile shows "—",
 *    never "0%".
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { assignedDepotId: 'depot-1', fullName: 'Rina' } }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    depots: [{ id: 'depot-1', name: 'Depot Utama' }],
    selected: { id: 'depot-1', name: 'Depot Utama' },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/performance',
  useSearchParams: () => new URLSearchParams(),
}));

import ManagerHome from '@/app/m/manager/page';
import DriverPerformancePage from '@/app/driver/performance/page';

vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const sla = (over: Record<string, unknown>) => ({
  from: null,
  to: null,
  thresholdMinutes: 120,
  totalDelivered: 0,
  onTime: 0,
  breached: 0,
  slaRate: null,
  avgMinutes: null,
  failedCount: 0,
  ...over,
});

function serve(deliverySla: unknown) {
  get.mockImplementation((url: string) => {
    if (url.includes('/dashboard/executive'))
      return Promise.resolve({ sales: { buckets: [] }, deliverySla });
    if (url.includes('/deliveries')) return Promise.resolve({ items: [], total: 0 });
    if (url.includes('/approvals')) return Promise.resolve({ total: 0 });
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 01:00 WIB on 1 Oct = 18:00Z on 30 Sep: the UTC month is still September.
  vi.setSystemTime(new Date('2026-09-30T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('HD-6 A4 manager home SLA', () => {
  it('asks for the current WIB month, not all time', async () => {
    serve(sla({ totalDelivered: 4, onTime: 3, slaRate: 0.75 }));
    render(<ManagerHome />);
    await waitFor(() => expect(screen.getByText('75%')).toBeTruthy());
    const url = get.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/dashboard/executive'))!;
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('from')).toBe('2026-09-30T17:00:00.000Z');
    expect(q.get('to')).toBe('2026-10-31T17:00:00.000Z');
    expect(q.get('depotId')).toBe('depot-1');
    expect(screen.getByText('hrFix.managerHome.thisMonth')).toBeTruthy();
  });

  it('shows a dash, never 0%, when nothing was delivered', async () => {
    serve(sla({}));
    render(<ManagerHome />);
    await waitFor(() => expect(screen.getByText('SLA tepat waktu')).toBeTruthy());
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('HD-6 A4 driver performance with no depot rank', () => {
  it('renders without the rank card when rank is null', async () => {
    get.mockResolvedValue({
      weekStart: '2026-07-13', delivered: 0, deliveredPrev: 0, perDay: [0, 0, 0, 0, 0, 0, 0],
      onTime: 0, onTimeRate: 0, failed: 0, rating: null, ratingPrev: null,
      rank: null, rankPrev: null, depotCouriers: 1, target: 45, targetMet: false,
    });
    render(<DriverPerformancePage />);
    await waitFor(() => expect(screen.getByText('hrFix.driverPerf.title')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('hrFix.driverPerf.depotRank')).toBeNull());
    expect(screen.queryByText(/^#/)).toBeNull();
  });
});
