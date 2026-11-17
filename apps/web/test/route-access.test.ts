import { afterEach, describe, expect, it, vi } from 'vitest';

import { canOpenRoute, twinFor } from '@/lib/route-access';

/**
 * PR-1a. A link is only worth drawing if the person who sees it can land on the page behind
 * it: the role passes the page's own gate AND this binary carries the route. Every case
 * below is a door that either opens or is certain to be refused.
 */
const WEB: Array<[role: string, href: string, opens: boolean]> = [
  // MARKETING's partial /hq door: its own five screens, nothing else of the console.
  ['MARKETING', '/hq/campaigns', true],
  ['MARKETING', '/hq/forms/segment', true],
  ['MARKETING', '/hq', false],
  // Holds promotionRead, but the screen is not on its door list.
  ['MARKETING', '/hq/promotions', false],
  // The console door alone is not enough: the row's capability is the page's gate.
  ['HEAD_OFFICE', '/hq/flags', false],
  ['SUPER_ADMIN', '/hq/flags', true],
  ['HEAD_OFFICE', '/hq/promotions', true],
  ['MANAGER', '/hq', false],
  ['FINANCE', '/hq/payments', true],
  // /dashboard rows follow the rail's own gate.
  ['HEAD_OFFICE', '/dashboard/walk-in', false],
  ['MANAGER', '/dashboard/walk-in', true],
  ['MANAGER', '/dashboard/customers/detail?id=c-1', true],
  ['FINANCE', '/dashboard/customers/detail?id=c-1', false],
  // The depot home renders for the operator and the franchise owner, who hold no `dashboard`.
  ['KEPALA_DEPOT', '/dashboard', true],
  ['FRANCHISE_OWNER', '/dashboard', true],
  ['STAFF_DEPOT', '/dashboard', false],
  ['MARKETING', '/dashboard', false],
  // No rail row: the page keeps its own say, so the link is not hidden.
  ['KEPALA_DEPOT', '/dashboard/operator-settings', true],
  // HR console: the console gate, then the row's own.
  ['HR', '/hr/settings', true],
  ['FINANCE', '/hr/settings', false],
  ['FINANCE', '/hr/customers', false],
  ['FINANCE', '/hr/payroll', true],
  ['STAFF_DEPOT', '/hr/leave', false],
  // Self-service is open to anyone signed in; the server answers for the linked employee.
  ['STAFF_DEPOT', '/hr/me/check-in', true],
  // The phone consoles.
  ['STAFF_DEPOT', '/driver', true],
  ['MANAGER', '/driver', false],
  ['MANAGER', '/m/manager', true],
  ['SUPERVISOR', '/m/manager', false],
  ['MANAGER', '/resellers', true],
  ['FINANCE', '/resellers', false],
  // The shop is not gated by role.
  ['CUSTOMER', '/products', true],
];

describe('canOpenRoute on the web build', () => {
  it.each(WEB)('%s → %s = %s', (role, href, opens) => {
    expect(canOpenRoute(href, role)).toBe(opens);
  });

  it('reads the path the way the exported build spells it', () => {
    // `trailingSlash: true`: the APK router hands over `/driver/`, the web `/driver`.
    expect(canOpenRoute('/driver/', 'STAFF_DEPOT')).toBe(true);
    expect(canOpenRoute('/hq/flags/', 'HEAD_OFFICE')).toBe(false);
    expect(canOpenRoute('/dashboard/walk-in/?phone=0812#top', 'MANAGER')).toBe(true);
    // The exact-match gates are the ones a stray slash would slip past.
    expect(canOpenRoute('/dashboard/', 'STAFF_DEPOT')).toBe(false);
  });

  it('refuses a signed-out reader every console', () => {
    for (const href of ['/hq/campaigns', '/dashboard/orders', '/hr/me', '/driver', '/m/manager']) {
      expect(canOpenRoute(href, null)).toBe(false);
    }
  });
});

describe('canOpenRoute per binary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function inBinary(pruned: string, segments: string) {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', pruned);
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', segments);
    vi.resetModules();
    return (await import('@/lib/route-access')).canOpenRoute;
  }

  it('Ops: no /hq at all, and only the HR screens the build keeps', async () => {
    const open = await inBinary(
      '/hq/*,/hr,/hr/employees/*,/hr/payroll/*,/hr/leave/*',
      'dashboard,driver,hr,m,resellers,login,products',
    );
    // A role that may open the page still cannot land on a route the bundle does not have.
    expect(open('/hq/campaigns', 'MARKETING')).toBe(false);
    expect(open('/hq', 'HEAD_OFFICE')).toBe(false);
    expect(open('/hr/payroll', 'HR')).toBe(false);
    // The HR index is pruned on its own, and the APK spells it with a slash.
    expect(open('/hr/', 'HR')).toBe(false);
    expect(open('/hr/leave', 'MANAGER')).toBe(false);
    expect(open('/hr/attendance', 'HR')).toBe(true);
    expect(open('/hr/me/check-in', 'STAFF_DEPOT')).toBe(true);
    expect(open('/dashboard/walk-in', 'MANAGER')).toBe(true);
    expect(open('/m/manager/', 'MANAGER')).toBe(true);
  });

  it('Customer: none of the staff consoles', async () => {
    const open = await inBinary(
      '/hq/*,/hr/*,/dashboard/*,/driver/*,/m/*,/resellers/*',
      'products,orders,checkout,account,cart,login',
    );
    expect(open('/dashboard/orders', 'MANAGER')).toBe(false);
    expect(open('/driver', 'STAFF_DEPOT')).toBe(false);
    expect(open('/products', 'CUSTOMER')).toBe(true);
  });
});

describe('twinFor', () => {
  it('spells a twinned screen the way the console asking for it does', () => {
    expect(twinFor('/hq/churn', 'dashboard')).toBe('/dashboard/churn');
    expect(twinFor('/dashboard/churn', 'hq')).toBe('/hq/churn');
    expect(twinFor('/hq/compare', 'dashboard')).toBe('/dashboard/compare');
    expect(twinFor('/dashboard/monthly-pnl', 'hq')).toBe('/hq/pnl');
    expect(twinFor('/hq/pnl', 'dashboard')).toBe('/dashboard/monthly-pnl');
  });

  it('keeps the query and leaves an untwinned screen alone', () => {
    expect(twinFor('/hq/inventory?low=1', 'dashboard')).toBe('/dashboard/inventory?low=1');
    expect(twinFor('/hq/inventory', 'hq')).toBe('/hq/inventory');
    expect(twinFor('/hq/analytics', 'dashboard')).toBe('/hq/analytics');
    expect(twinFor('/dashboard/orders', 'hq')).toBe('/dashboard/orders');
  });
});
