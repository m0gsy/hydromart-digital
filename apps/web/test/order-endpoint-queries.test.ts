import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

/**
 * Order, courier and identity URL builders, on the branches that choose what the server is
 * told.
 *
 * The same class of defect keeps appearing in this repo: a filter the screen sets, a URL
 * that never carries it, and a list that silently answers something else. These builders
 * are pure, so pinning the contract is cheap; what it buys is that the next edit to a query
 * string has to notice it changed one.
 */

describe('order management endpoints', () => {
  it('asks for the queue with no filters at all', () => {
    expect(endpoints.orders.manage()).toBe('/orders/api/v1/orders/manage');
  });

  it('carries paging, the unrouted tray, and drops false flags', () => {
    const url = endpoints.orders.manage({ page: 2, limit: 25, unrouted: true });
    expect(url).toContain('page=2');
    expect(url).toContain('limit=25');
    expect(url).toContain('unrouted=true');
    // `unrouted: undefined` is "every order", which is a different question.
    expect(endpoints.orders.manage({ page: 1 })).not.toContain('unrouted');
  });

  /*
   * CA-2-56: assigning a depot to an order that has none, and MOVING one that already has
   * a depot, are different acts on different routes — the second releases one depot's stock
   * hold and takes another's.
   */
  it('separates assigning a depot from moving one', () => {
    expect(endpoints.orders.assignDepot('o-1')).toBe('/orders/api/v1/orders/manage/o-1/depot');
    expect(endpoints.orders.moveDepot('o-1')).toBe(
      '/orders/api/v1/orders/manage/o-1/depot/move',
    );
  });
});

describe('courier and roster endpoints', () => {
  /*
   * CA-4-48: the depot's review list for field incidents. Without the depot the route
   * answers from the caller's own scope, which is right for a depot-locked reader and
   * wrong for head office looking at one depot.
   */
  it('scopes courier field incidents to a depot when one is named', () => {
    expect(endpoints.deliveries.incidents.forDepot('d-1')).toBe(
      '/deliveries/api/v1/field-incidents?depotId=d-1',
    );
    expect(endpoints.deliveries.incidents.forDepot()).toBe('/deliveries/api/v1/field-incidents');
  });

  /*
   * CA-1-66: the frame a punch was accepted on, behind the session rather than at a bucket
   * URL. The half — in or out — is part of the path, because they are two different photos.
   */
  it('addresses each half of a punch separately', () => {
    expect(endpoints.hr.attendancePhoto('a-1', 'in')).toContain('/a-1/photo/in');
    expect(endpoints.hr.attendancePhoto('a-1', 'out')).toContain('/a-1/photo/out');
  });

  it('asks for one depot’s courier roster, and for the whole one', () => {
    expect(endpoints.auth.drivers).toBe('/auth/api/v1/auth/drivers');
    expect(endpoints.auth.driversAt('d 1')).toContain('depotId=d%201');
  });
});
