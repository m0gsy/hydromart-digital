// @vitest-environment jsdom
/**
 * Fase F — notifications that tell the truth.
 *
 * F1 the channel toggles on /account are decorative. `push` is never read by the sender,
 *    and `email`/`whatsapp` name two channels that do not exist anywhere in the repo —
 *    a switch that promises something nothing can deliver.
 * F2 an HR notification pushes a staff member at `/notifications`, which is a
 *    CUSTOMER-only feed, so the tap ends in a 403.
 * F3 `BROADCAST` is missing from the client's event union and from both dictionaries, so
 *    every campaign renders as the literal string `notifications.events.BROADCAST`.
 * F4 the ops group map holds two of the nine events crm actually files there, so seven
 *    of them are reachable by no filter chip at all.
 * F5 signing out never releases the FCM registration: the device keeps receiving the
 *    previous account's pushes, and the next account is never registered because the
 *    endpoint is identical and dedupes.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, post, get, patch, del, unsubscribeFromPush } = vi.hoisted(() => ({
  replace: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));
let customer: { id: string; role: string } | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/notifications',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch, del } };
});
vi.mock('@/lib/push', () => ({ unsubscribeFromPush, pushSupported: () => true }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));

import NotificationsPage from '@/app/notifications/page';
import { LocaleProvider } from '@/lib/locale-context';
import { OPS_EVENT_GROUP, OPS_FILTERS, filterOpsFeed } from '@/lib/ops-notifications';
import { OPS_EVENTS } from '@/lib/types';
import { id as idDict } from '@/lib/dictionaries/id';
import { en as enDict } from '@/lib/dictionaries/en';

beforeEach(() => {
  replace.mockReset();
  post.mockReset().mockResolvedValue(undefined);
  get.mockReset().mockResolvedValue([]);
  del.mockReset().mockResolvedValue(undefined);
  unsubscribeFromPush.mockReset().mockResolvedValue('unsubscribed');
  customer = null;
});
afterEach(() => vi.clearAllMocks());

describe('F3 · every event crm can file has a title in both dictionaries', () => {
  it('BROADCAST is named, not rendered as its own key', () => {
    expect(idDict.notifications.events.BROADCAST).toBeTruthy();
    expect(enDict.notifications.events.BROADCAST).toBeTruthy();
    expect(idDict.notifications.events.BROADCAST).not.toContain('notifications.events');
  });

  it('the two dictionaries name exactly the same set of events', () => {
    expect(Object.keys(idDict.notifications.events).sort()).toEqual(
      Object.keys(enDict.notifications.events).sort(),
    );
  });

  it('every ops event is named too — they share the same feed rows', () => {
    const named = new Set(Object.keys(idDict.notifications.events));
    expect(OPS_EVENTS.filter((e) => !named.has(e))).toEqual([]);
  });
});

describe('F4 · every ops event belongs to a filter chip', () => {
  it('leaves none of the nine ungrouped', () => {
    expect(OPS_EVENTS.filter((e) => !OPS_EVENT_GROUP[e])).toEqual([]);
  });

  it('every group a chip offers is a group some event is actually in', () => {
    const chips = new Set(OPS_FILTERS.map((f) => f.key).filter((k) => k !== 'all' && k !== 'unread'));
    const used = new Set(Object.values(OPS_EVENT_GROUP));
    expect([...chips].filter((c) => !used.has(c as never))).toEqual([]);
    expect([...used].filter((u) => !chips.has(u))).toEqual([]);
  });

  it('an HR notification is reachable by a chip', () => {
    const feed = [
      { id: 'n1', event: 'LEAVE_APPROVED', message: 'x', createdAt: '2026-08-20T00:00:00Z', readAt: null },
      { id: 'n2', event: 'STOCK_LOW', message: 'y', createdAt: '2026-08-20T00:00:00Z', readAt: null },
    ] as never[];
    const group = OPS_EVENT_GROUP.LEAVE_APPROVED;
    expect(group).toBeTruthy();
    expect(filterOpsFeed(feed, group as never, () => false).map((n) => n.id)).toEqual(['n1']);
  });
});

describe('F2 · a staff member never lands on the customer inbox', () => {
  it('sends a signed-in staff member to their own console feed', async () => {
    customer = { id: 's1', role: 'KEPALA_DEPOT' };
    render(<NotificationsPage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]![0]).toBe('/dashboard/notifications');
    expect(get).not.toHaveBeenCalled();
  });

  it('leaves a customer where they are', async () => {
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<NotificationsPage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });
});
