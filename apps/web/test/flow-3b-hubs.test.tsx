// @vitest-environment jsdom
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-3b of the flow plan: the depot console's menu is 17 hubs. The rail and the phone sheet
 * show one row per hub; the hub's screens are tabs across the top of each of them; the head of
 * depot's "Kelola" tabs are the same table, so each carries its row's gate.
 */
const who = { role: 'MANAGER', path: '/dashboard' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => who.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Uji', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], selected: null, selectedId: null, scopedId: null, ready: true }),
}));
vi.mock('@/lib/ops-notifications', () => ({ useOpsNotifications: () => ({ unreadCount: 0 }) }));

const ROLES = [
  'CUSTOMER',
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
];
/** The two builds a depot screen ships in: the web, and the Ops APK's prune set. */
const BINARIES: Array<[name: string, pruned: string, segments: string]> = [
  ['web', '', ''],
  [
    'ops',
    '/hq/*,/hr,/hr/employees/*,/hr/payroll/*',
    'dashboard,driver,hr,m,resellers,login,products',
  ],
];
async function inBinary(pruned: string, segments: string) {
  vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', pruned);
  vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', segments);
  vi.resetModules();
  const nav = await import('@/lib/ops-nav');
  const { canOpenRoute } = await import('@/lib/route-access');
  return { ...nav, canOpenRoute };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Every screen under /dashboard, read off the app folder. */
function dashboardRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${route}/${name}`);
      else if (name === 'page.tsx') out.push(route);
    }
  };
  walk(join(process.cwd(), 'src/app/dashboard'), '/dashboard');
  return out;
}
/** Screens no menu row leads to; each is opened from a button on the page named beside it. */
const PAGE_ONLY: Record<string, string> = {
  '/dashboard/resellers/import': '/resellers (Impor)',
  '/dashboard/sales-import': '/hq/reports/export (PR #925)',
  // PR-3d: merged into their twins; the old routes redirect.
  '/dashboard/profile': 'redirects to /dashboard/account',
  '/dashboard/operator-settings': 'redirects to /dashboard/account',
  '/dashboard/depot-settings': 'redirects to /dashboard/settings',
};

describe('the hub table', () => {
  it('holds each screen in exactly one hub', async () => {
    const { GROUPS } = await inBinary('', '');
    const hrefs = GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it('every depot screen is a hub screen, below one, or opened from a page', async () => {
    const { GROUPS } = await inBinary('', '');
    const hrefs = GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter(
      (h) => h !== '/dashboard',
    );
    const orphans = dashboardRoutes().filter(
      (r) =>
        r !== '/dashboard' &&
        !(r in PAGE_ONLY) &&
        !hrefs.some((h) => r === h || r.startsWith(`${h}/`)),
    );
    expect(orphans).toEqual([]);
  });

  it.each(BINARIES)(
    '%s: a row never leads to a page that refuses the role',
    async (_b, pruned, segments) => {
      const { GROUPS, canOpenRoute } = await inBinary(pruned, segments);
      const refused: string[] = [];
      for (const role of ROLES)
        for (const item of GROUPS.flatMap((g) => g.items))
          if (item.show(role) && !canOpenRoute(item.href, role))
            refused.push(`${role} ${item.href}`);
      expect(refused).toEqual([]);
    },
  );

  it.each(BINARIES)(
    '%s: each hub a role sees leads somewhere it may open, and fits the target',
    async (_b, pruned, segments) => {
      const { hubsFor, canOpenRoute } = await inBinary(pruned, segments);
      for (const role of ROLES) {
        const hubs = hubsFor(role);
        // The plan's target: a depot manager's rail went from 60 rows to at most 18.
        expect(hubs.length).toBeLessThanOrEqual(18);
        for (const h of hubs) expect(canOpenRoute(h.items[0]!.href, role)).toBe(true);
      }
      expect(hubsFor('MANAGER').length).toBeLessThanOrEqual(18);
    },
  );
});

describe('hub tabs', () => {
  it('a hub screen shows its siblings, and marks itself', async () => {
    const { HubTabs } = await import('@/components/dashboard/hub-tabs');
    who.role = 'MANAGER';
    who.path = '/dashboard/inventory/';
    const { container } = render(<HubTabs />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard/inventory',
      '/dashboard/returns',
      '/dashboard/wastage',
      '/dashboard/meter',
    ]);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(links[1]!.getAttribute('aria-current')).toBeNull();
  });

  it('shows only the screens the role may open', async () => {
    const { HubTabs } = await import('@/components/dashboard/hub-tabs');
    who.role = 'KEPALA_DEPOT';
    who.path = '/dashboard/inventory';
    const { container } = render(<HubTabs />);
    // Susut & kerusakan is a manager's screen.
    expect(container.querySelector('a[href="/dashboard/wastage"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/meter"]')).toBeTruthy();
  });

  it('is absent below a hub screen, and on a hub of one screen', async () => {
    const { HubTabs } = await import('@/components/dashboard/hub-tabs');
    who.role = 'MANAGER';
    who.path = '/dashboard/orders/detail';
    expect(render(<HubTabs />).container.querySelector('nav')).toBeNull();
    who.path = '/dashboard/walk-in';
    expect(render(<HubTabs />).container.querySelector('nav')).toBeNull();
  });
});

describe('the rail and the operator console read the table', () => {
  it('the rail has one row per hub the role sees', async () => {
    const { OpsRail } = await import('@/components/dashboard/ops-rail');
    const { hubsFor } = await import('@/lib/ops-nav');
    who.role = 'MANAGER';
    who.path = '/dashboard/wastage';
    const { container } = render(<OpsRail />);
    const rows = Array.from(container.querySelectorAll('nav a'));
    expect(rows.map((a) => a.textContent)).toEqual(
      hubsFor('MANAGER').map((h) => `ops.groups.${h.hub.headKey}`),
    );
    expect(container.querySelector('nav a[aria-current="page"]')?.textContent).toBe(
      'ops.groups.stock',
    );
  });

  it("the head of depot's Kelola tabs carry their rows' gates", async () => {
    const { OperatorShell } = await import('@/components/operator/operator-shell');
    const { canOpenRoute } = await import('@/lib/route-access');
    who.role = 'KEPALA_DEPOT';
    who.path = '/dashboard';
    const { container } = render(<OperatorShell>x</OperatorShell>);
    const tabs = Array.from(container.querySelectorAll('nav a')).map((a) =>
      a.getAttribute('href')!,
    );
    // "Kelola depot" led a head of depot to a page that refuses them.
    expect(tabs).not.toContain('/dashboard/depots');
    // their settings are the account screen now (PR-3d merged operator-settings into it)
    expect(tabs).toContain('/dashboard/account');
    expect(tabs.filter((h) => !canOpenRoute(h, 'KEPALA_DEPOT'))).toEqual([]);
  });

  it('the operator bar holds one Kelola tab per hub, and one current tab', async () => {
    const { OperatorShell } = await import('@/components/operator/operator-shell');
    who.role = 'KEPALA_DEPOT';
    who.path = '/dashboard/meter/';
    const { container } = render(<OperatorShell>x</OperatorShell>);
    const lit = Array.from(container.querySelectorAll('nav a[aria-current="page"]'));
    // Meteran is a Stok screen; Inventory, a primary tab, stands for the Stok hub.
    expect(lit.map((a) => a.textContent)).toEqual(['hrFix.opNav.inventory']);
    // and the Stok hub is not a Kelola tab of its own beside it
    expect(container.querySelector('nav a[href="/dashboard/meter"]')).toBeNull();
    const labels = Array.from(container.querySelectorAll('nav a')).map((a) => a.textContent);
    expect(labels.filter((l) => l?.startsWith('ops.nav.'))).toEqual([]);
  });

  it("the head of depot's seven primary tabs are each a row of the table", async () => {
    const { OperatorShell } = await import('@/components/operator/operator-shell');
    who.role = 'KEPALA_DEPOT';
    who.path = '/dashboard';
    const { container } = render(<OperatorShell>x</OperatorShell>);
    const primary = Array.from(container.querySelectorAll('nav a'))
      .filter((a) => a.textContent?.startsWith('hrFix.opNav.'))
      .map((a) => a.getAttribute('href'));
    expect(primary).toEqual([
      '/dashboard',
      '/dashboard/orders',
      '/dashboard/walk-in',
      '/dashboard/tracking',
      '/dashboard/inventory',
      '/dashboard/returns',
      '/dashboard/settlements',
    ]);
  });

  it('a primary tab takes its gate from the table: a head of depot without tracking loses Kurir', async () => {
    // What an edit of the built-in role in /hq/access does: the capability goes, the tab must too.
    vi.doMock('@/lib/roles', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/roles')>()),
      canViewTracking: () => false,
    }));
    vi.resetModules();
    const { OperatorShell } = await import('@/components/operator/operator-shell');
    who.role = 'KEPALA_DEPOT';
    who.path = '/dashboard';
    const { container } = render(<OperatorShell>x</OperatorShell>);
    expect(container.querySelector('nav a[href="/dashboard/tracking"]')).toBeNull();
    expect(container.querySelector('nav a[href="/dashboard/inventory"]')).not.toBeNull();
    vi.doUnmock('@/lib/roles');
  });

  it('the row with the unread badge opens the feed it counts', async () => {
    vi.doMock('@/lib/unread', () => ({ useUnreadCount: () => 0, useOpsUnreadCount: () => 3 }));
    vi.resetModules();
    const { OpsRail } = await import('@/components/dashboard/ops-rail');
    who.role = 'MANAGER';
    who.path = '/dashboard/orders';
    const { container } = render(<OpsRail />);
    const row = Array.from(container.querySelectorAll('nav a')).find((a) =>
      a.textContent?.startsWith('ops.groups.summary'),
    );
    expect(row?.getAttribute('href')).toBe('/dashboard/notifications');
    vi.doUnmock('@/lib/unread');
  });
});
