// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 6a (plan PR-6): "/hq/notifications (saat ini tanpa tujuan sama sekali) memakai tujuan
 * dan filter jenis". Its rows were plain text, and the feed had no kinds to filter by.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn().mockResolvedValue({}) } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'SUPER_ADMIN' }, ready: true }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/notifications',
  useSearchParams: () => new URLSearchParams(),
}));

import HqNotificationsPage from '@/app/hq/notifications/page';

const row = (id: string, event: string, destination: string | null) => ({
  id,
  event,
  destination,
  message: `pesan ${id}`,
  status: 'SENT',
  readAt: null,
  createdAt: '2026-11-20T01:00:00.000Z',
});

afterEach(() => get.mockReset());

describe('/hq/notifications', () => {
  it('links a row to its screen (an approval on the desktop console) and filters by kind', async () => {
    get.mockResolvedValue([
      row('n-1', 'APPROVAL_REQUESTED', '/m/manager/approvals/detail?id=a-1'),
      row('n-2', 'STOCK_LOW', '/dashboard/inventory?low=1&depot=d-1'),
      row('n-3', 'BROADCAST', null),
    ]);
    render(<HqNotificationsPage />);

    const approval = await screen.findByRole('link', { name: 'notifications.events.APPROVAL_REQUESTED' });
    expect(approval.getAttribute('href')).toBe('/dashboard/approvals/detail?id=a-1');
    expect(screen.getByRole('link', { name: 'notifications.events.STOCK_LOW' }).getAttribute('href')).toBe(
      '/dashboard/inventory?low=1&depot=d-1',
    );
    // No destination: plain text, not a link.
    expect(screen.queryByRole('link', { name: 'notifications.events.BROADCAST' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'opsFix.notif.filterStock' }));
    expect(screen.queryByText('pesan n-1')).toBeNull();
    expect(screen.getByText('pesan n-2')).toBeTruthy();
  });
});
