// @vitest-environment jsdom
/*
 * O1b — the reader half. O1a started storing where a notification leads (the column shipped
 * one release earlier and has been filling since), so the in-app list can finally do what a
 * tap from the phone's tray already does: open the thing the message is about.
 *
 * A row with no destination stays plain text. An affordance that leads nowhere is worse
 * than no affordance — and `storedDestinationFor` deliberately answers null for every event
 * whose only "destination" is this very list.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER' }, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/notifications',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import NotificationsPage from '@/app/notifications/page';

const row = (id: string, event: string, destination: string | null) => ({
  id,
  event,
  message: `pesan ${id}`,
  destination,
  createdAt: '2026-08-23T03:00:00.000Z',
});

beforeEach(() => {
  get.mockReset();
});
afterEach(() => vi.clearAllMocks());

const hrefFor = (text: string) => screen.getByText(text).closest('a')?.getAttribute('href') ?? null;

describe('O1b · a notification opens what it is about', () => {
  it('makes a row with a destination a link to it', async () => {
    get.mockResolvedValue([row('n-1', 'ORDER_DELIVERED', '/orders/detail?id=o-9')]);
    render(<NotificationsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('pesan n-1')).toBeTruthy());
    expect(hrefFor('pesan n-1')).toBe('/orders/detail?id=o-9');
  });

  it('leaves a row without one as plain text', async () => {
    get.mockResolvedValue([row('n-2', 'STOCK_LOW', null)]);
    render(<NotificationsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('pesan n-2')).toBeTruthy());
    expect(hrefFor('pesan n-2')).toBeNull();
  });

  it('refuses a destination that is not one of this app own routes', async () => {
    get.mockResolvedValue([row('n-3', 'ORDER_DELIVERED', 'https://evil.example/steal')]);
    render(<NotificationsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('pesan n-3')).toBeTruthy());
    expect(hrefFor('pesan n-3')).toBeNull();
  });
});
