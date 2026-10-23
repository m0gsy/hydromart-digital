// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The staff notification history listed alerts ("Pesanan baru masuk ...") and a tap only
 * toggled the read dot - the push opened the order, the list did not. The server already
 * stores where each alert leads (`destination`); these pin that the rows now follow it, in the
 * desktop console and in the phone console, and that a row with nowhere to go stays inert.
 * Titles are pinned too: only two events had one, the rest showed the raw event key.
 */
const { markRead, feedRows } = vi.hoisted(() => ({
  markRead: vi.fn(),
  feedRows: { value: [] as unknown[] },
}));

vi.mock('@/lib/ops-notifications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ops-notifications')>('@/lib/ops-notifications');
  return {
    ...actual,
    useOpsNotifications: () => ({
      feed: { loading: false, error: null, reload: vi.fn() },
      all: feedRows.value,
      visible: feedRows.value,
      filter: 'all',
      setFilter: vi.fn(),
      isRead: () => false,
      unreadCount: feedRows.value.length,
      markRead,
      markAllRead: vi.fn(),
    }),
  };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'KEPALA_DEPOT' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import DashboardNotificationsPage from '@/app/dashboard/notifications/page';
import ManagerNotificationsPage from '@/app/m/manager/notifications/page';
import { LocaleProvider } from '@/lib/locale-context';
import { notificationHref } from '@/lib/notification-link';

const row = (over: Record<string, unknown>) => ({
  id: 'n-1',
  event: 'DEPOT_ORDER_INCOMING',
  customerId: null,
  phone: '0811',
  message: 'Pesanan baru masuk: HM-1 · Rp 9.000.',
  status: 'SENT',
  error: null,
  createdAt: new Date().toISOString(),
  readAt: null,
  destination: '/dashboard/orders?order=ord-1',
  ...over,
});

beforeEach(() => {
  markRead.mockClear();
  feedRows.value = [];
});

describe('notificationHref', () => {
  it('keeps a route this app serves, query and all', () => {
    expect(notificationHref('/dashboard/orders?order=ord-1')).toBe('/dashboard/orders?order=ord-1');
  });

  it('is null for no destination, an absolute URL, and a protocol-relative one', () => {
    expect(notificationHref(null)).toBeNull();
    expect(notificationHref(undefined)).toBeNull();
    expect(notificationHref('')).toBeNull();
    expect(notificationHref('https://evil.example/x')).toBeNull();
    expect(notificationHref('//evil.example/x')).toBeNull();
  });

  it('does not turn a route this build lacks into a link to the home screen', () => {
    expect(notificationHref('/')).toBe('/');
    expect(notificationHref('relative/path')).toBeNull();
  });
});

describe.each([
  ['the desktop console', DashboardNotificationsPage],
  ['the phone console', ManagerNotificationsPage],
])('%s history', (_name, Page) => {
  const renderPage = () =>
    render(
      <LocaleProvider>
        <Page />
      </LocaleProvider>,
    );

  it('opens the order an alert is about, and marks it read on the way', async () => {
    feedRows.value = [row({})];
    renderPage();
    const link = screen.getByRole('link', { name: /Pesanan baru masuk/ });
    expect(link).toHaveAttribute('href', '/dashboard/orders?order=ord-1');
    await userEvent.click(link);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('names every alert in words, not by its raw event key', () => {
    feedRows.value = [
      row({ id: 'a', event: 'DEPOT_ORDER_INCOMING' }),
      row({ id: 'b', event: 'STOCK_UNTRACKED', destination: null }),
      row({ id: 'c', event: 'DEPOT_ORDER_CANCELLED' }),
    ];
    renderPage();
    expect(screen.queryByText('DEPOT_ORDER_INCOMING')).toBeNull();
    expect(screen.queryByText('STOCK_UNTRACKED')).toBeNull();
    expect(screen.queryByText('DEPOT_ORDER_CANCELLED')).toBeNull();
    expect(screen.getByText('Pesanan baru masuk')).toBeInTheDocument();
    expect(screen.getByText('Pesanan dibatalkan pelanggan')).toBeInTheDocument();
  });

  it('leaves a row with no destination as a plain tap-to-read button', async () => {
    feedRows.value = [row({ event: 'STOCK_UNTRACKED', destination: null, message: 'Penjualan tanpa kartu stok' })];
    renderPage();
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Penjualan tanpa kartu stok/ }));
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('refuses a destination that points off the app', () => {
    feedRows.value = [row({ destination: 'https://evil.example/steal' })];
    renderPage();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
