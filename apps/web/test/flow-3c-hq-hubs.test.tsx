// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * PR-3c of the flow plan: the HQ menu is 14 hubs, one rail row each, and "Formulir" is gone —
 * each form is a button on the list it adds to. A role lands on its hub of work.
 */
const who = { role: 'HEAD_OFFICE', path: '/hq' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => who.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));

import { HqHubTabs } from '@/components/hq/hq-hub-tabs';
import { HQ_GROUPS, currentHqHub, hqHubsFor, hqHubsInLandingOrder } from '@/lib/hq-nav';
import { consoleHome } from '@/lib/roles';
import { canOpenRoute } from '@/lib/route-access';

const HQ_ROLES = ['HEAD_OFFICE', 'DIREKTUR', 'FINANCE', 'SUPER_ADMIN', 'MARKETING'];
const APP = join(process.cwd(), 'src/app');

function hqRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${route}/${name}`);
      else if (name === 'page.tsx') out.push(route);
    }
  };
  walk(join(APP, 'hq'), '/hq');
  return out;
}

describe('the HQ hub table', () => {
  it('holds each screen once, in 14 hubs and the page-only forms', () => {
    const hrefs = HQ_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs.length).toBe(new Set(hrefs).size);
    expect(HQ_GROUPS.filter((g) => !g.pageOnly)).toHaveLength(14);
  });

  it('every HQ page is a hub screen, below one, or a form reached from its list', () => {
    const hrefs = HQ_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== '/hq');
    const orphans = hqRoutes().filter(
      (r) =>
        r !== '/hq' && r !== '/hq/login' && !hrefs.some((h) => r === h || r.startsWith(`${h}/`)),
    );
    expect(orphans).toEqual([]);
  });

  it('each dissolved form is a button on the list it adds to', () => {
    const lists: Record<string, string> = {
      '/hq/forms/pricing-rule': 'hq/pricing',
      '/hq/forms/voucher': 'hq/vouchers',
      '/hq/forms/commission': 'hq/reconciliation',
      '/hq/forms/segment': 'hq/campaigns',
      '/hq/staff/import': 'hq/staff',
      '/hq/depots/import': 'hq/depots',
    };
    const forms = HQ_GROUPS.filter((g) => g.pageOnly).flatMap((g) => g.items.map((i) => i.href));
    expect(forms.sort()).toEqual(Object.keys(lists).sort());
    for (const [form, list] of Object.entries(lists))
      expect(readFileSync(join(APP, list, 'page.tsx'), 'utf8')).toContain(`"${form}"`);
  });

  it.each(HQ_ROLES)('%s: at most 14 rows, and no screen in them refuses the role', (role) => {
    const hubs = hqHubsFor(role);
    expect(hubs.length).toBeLessThanOrEqual(14);
    const refused = hubs.flatMap((h) => h.items).filter((i) => !canOpenRoute(i.href, role));
    expect(refused.map((i) => i.href)).toEqual([]);
  });

  it('FINANCE lands on its hub of work, not on search', () => {
    const finance = hqHubsFor('FINANCE').find((h) => h.headKey === 'finance')!;
    const home = consoleHome('FINANCE', false);
    expect(home).not.toBe('/hq/search');
    expect(finance.items.map((i) => i.href)).toContain(home);
  });

  it('a form lights the hub of the list its button is on', () => {
    expect(currentHqHub('/hq/forms/commission/', 'FINANCE')).toBe('franchise');
    expect(currentHqHub('/hq/forms/segment', 'MARKETING')).toBe('marketing');
    expect(currentHqHub('/hq/forms/pricing-rule', 'HEAD_OFFICE')).toBe('catalog');
    expect(currentHqHub('/hq/staff/import', 'SUPER_ADMIN')).toBe('staff');
  });

  it('a role without the overview has no Ringkasan row leading to its profile', () => {
    expect(hqHubsFor('FINANCE').map((h) => h.headKey)).not.toContain('overview');
    expect(hqHubsInLandingOrder('FINANCE')[0]!.headKey).toBe('finance');
  });

  it('head office and the director still land on the overview', () => {
    expect(consoleHome('HEAD_OFFICE', false)).toBe('/hq');
    expect(consoleHome('DIREKTUR', false)).toBe('/hq');
  });
});

describe('HQ hub tabs', () => {
  it("a hub screen shows its hub's screens and marks itself", () => {
    who.role = 'HEAD_OFFICE';
    who.path = '/hq/refunds/';
    const { container } = render(<HqHubTabs />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toContain('/hq/payments');
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/hq/refunds',
    );
  });

  it('is absent below a hub screen', () => {
    who.role = 'HEAD_OFFICE';
    who.path = '/hq/orders/detail';
    expect(render(<HqHubTabs />).container.querySelector('nav')).toBeNull();
  });
});
