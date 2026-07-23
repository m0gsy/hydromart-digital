import { describe, expect, it } from 'vitest';

import { filterOpsFeed, groupOpsFeedByDay } from '@/lib/ops-notifications';
import type { OpsNotification } from '@/lib/types';

const notif = (over: Partial<OpsNotification>): OpsNotification => ({
  id: 'n-1',
  event: 'STOCK_LOW',
  customerId: null,
  phone: '+62800',
  message: 'Galon 19L tersisa 3',
  status: 'SENT',
  error: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  readAt: null,
  ...over,
});

// Read-ness is what the server says, plus the optimistic overlay the hook layers on top.
const readByReceipt = (n: OpsNotification) => n.readAt != null;

describe('filterOpsFeed', () => {
  const feed = [
    notif({ id: 'a', event: 'STOCK_LOW' }),
    notif({ id: 'b', event: 'COURIER_INCIDENT', readAt: '2026-07-20T11:00:00.000Z' }),
    notif({ id: 'c', event: 'SOMETHING_NEW' }),
  ];

  it('passes everything through on "all"', () => {
    expect(filterOpsFeed(feed, 'all', readByReceipt).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps only rows this staff member has not read on "unread"', () => {
    expect(filterOpsFeed(feed, 'unread', readByReceipt).map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('groups by event, and an unknown event falls into neither group', () => {
    expect(filterOpsFeed(feed, 'stock', readByReceipt).map((n) => n.id)).toEqual(['a']);
    expect(filterOpsFeed(feed, 'courier', readByReceipt).map((n) => n.id)).toEqual(['b']);
  });
});

describe('groupOpsFeedByDay', () => {
  it('buckets consecutive same-day rows and preserves feed order', () => {
    const feed = [
      notif({ id: 'a', createdAt: '2026-07-20T10:00:00.000Z' }),
      notif({ id: 'b', createdAt: '2026-07-20T09:00:00.000Z' }),
      notif({ id: 'c', createdAt: '2026-07-19T09:00:00.000Z' }),
    ];
    const groups = groupOpsFeedByDay(feed, (iso) => iso.slice(0, 10));
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([
      ['2026-07-20', ['a', 'b']],
      ['2026-07-19', ['c']],
    ]);
  });

  it('returns nothing for an empty feed', () => {
    expect(groupOpsFeedByDay([], () => 'x')).toEqual([]);
  });
});
