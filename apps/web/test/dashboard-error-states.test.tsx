// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'm-1', role: 'MANAGER' } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selected: { id: 'depot-a', name: 'Depot A' },
    depots: [{ id: 'depot-a', name: 'Depot A' }],
    ready: true,
  }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import DashboardPage from '@/app/dashboard/page';

beforeEach(() => get.mockReset());
afterEach(() => vi.clearAllMocks());

/*
 * The manager landing page has three queues, and each one read `{data, loading}` and
 * nothing else — so a failed request rendered the SAME empty state as a genuinely quiet
 * depot. "No approvals waiting" and "we could not ask" are opposite answers, and the queue
 * that looks empty is the one a manager stops checking.
 */
describe('manager landing queues', () => {
  /** The exec summary at the bottom is a separate widget; give it a valid shape so the
   *  three queues are the only thing this test is looking at. */
  const QUEUES = ['/approvals/', '/inventory', '/deliveries/'];
  const routeReads = (queues: () => Promise<unknown>) =>
    get.mockImplementation((path: string) =>
      !QUEUES.some((q) => String(path).includes(q))
        ? Promise.resolve({
            sales: { buckets: [] },
            deliverySla: { totalDelivered: 0, onTime: 0, onTimeRate: 0 },
            topCustomers: { items: [] },
            sources: { order: 'ok', delivery: 'ok' },
            topDepots: { items: [] },
          })
        : queues(),
    );

  it('shows a retryable error instead of an empty queue when the reads fail', async () => {
    routeReads(() => Promise.reject(new Error('503')));
    render(
      <LocaleProvider>
        <DashboardPage />
      </LocaleProvider>,
    );

    // findAllBy* resolves at the FIRST match, so waiting on the count is what proves all
    // three queues recovered rather than just the one that settled first.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Coba lagi|Retry/i })).toHaveLength(3),
    );
    // The empty-state copy must NOT be what a failure looks like.
    expect(screen.queryByText(/Belum ada approval|Tidak ada approval/i)).toBeNull();
  });

  // The other half: a real empty answer still has to read as empty, or the fix would just
  // be "never show the empty state".
  it('still shows the empty state when the depot genuinely has nothing queued', async () => {
    routeReads(() => Promise.resolve([]));
    render(
      <LocaleProvider>
        <DashboardPage />
      </LocaleProvider>,
    );

    // Three empty queues, three empty states, and not one retry button.
    await screen.findByText(/Tidak ada approval tertunda/i);
    expect(screen.getByText(/Semua stok di atas batas minimum/i)).toBeTruthy();
    expect(screen.getByText(/Tidak ada kurir yang sedang mengantar/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Coba lagi|Retry/i })).toBeNull();
  });
});
