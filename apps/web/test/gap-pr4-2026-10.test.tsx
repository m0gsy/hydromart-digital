// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-a', selected: null, depots: [], ready: true }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import ManagerApprovalsPage from '@/app/m/manager/approvals/page';
import DepotSearchPage from '@/app/dashboard/search/page';

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
});

describe('/m/manager approvals', () => {
  it('asks for HELD items as well as PENDING, so a held item does not vanish', async () => {
    get.mockResolvedValue([]);
    render(<ManagerApprovalsPage />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('status=PENDING'))).toBe(true);
    expect(urls.some((u) => u.includes('status=HELD'))).toBe(true);
  });
});

describe('depot search', () => {
  it('says which source could not be reached instead of reporting no results', async () => {
    getCached.mockResolvedValue({ items: [] });
    get.mockImplementation(async (url: string) => {
      if (String(url).includes('/orders/manage')) throw new Error('down');
      return { items: [] };
    });
    render(<DepotSearchPage />);
    const box = screen.getByPlaceholderText('dashC.search.placeholder');
    fireEvent.change(box, { target: { value: 'HM-1' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(screen.getByText(/dashC\.search\.partial|dashC\.search\.orders/)).toBeTruthy());
  });
});

describe('/hq/broadcast for MARKETING (found by the full-stack browser pass)', () => {
  it('does not ask for the depot list MARKETING cannot read, and offers no per-depot audience', async () => {
    vi.resetModules();
    vi.doMock('@/lib/auth-context', () => ({
      useAuth: () => ({ customer: { id: 'u1', role: 'MARKETING' }, ready: true, signOut: vi.fn() }),
    }));
    vi.doMock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
    vi.doMock('@/components/confirm', () => ({
      useConfirm: () => ({ confirm: vi.fn(), askReason: vi.fn() }),
    }));
    get.mockResolvedValue({ count: 0 });
    getCached.mockResolvedValue({ items: [] });
    const { default: HqBroadcastPage } = await import('@/app/hq/broadcast/page');
    render(<HqBroadcastPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const urls = [...get.mock.calls, ...getCached.mock.calls].map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/depots/manage'))).toBe(false);
    expect(screen.queryByText('hq.broadcast.audiences.depot')).toBeNull();
    expect(screen.getByText('hq.broadcast.audiences.all')).toBeTruthy();
  });
});
