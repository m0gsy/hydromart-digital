import { describe, expect, it } from 'vitest';

import { hqGroupsForRole, hasPartialHqDoor, mayOpenHqPath, PARTIAL_HQ_DOOR } from '@/lib/hq-nav';
import { consoleHome, isHq } from '@/lib/roles';

const hrefs = (role: string) =>
  hqGroupsForRole(role as never).flatMap((g) => g.items.map((i) => i.href));

describe('MARKETING has a partial HQ door (owner decision 2026-10-15)', () => {
  it('sees exactly its allow-list, and nothing else it might hold a capability for', () => {
    expect(hrefs('MARKETING').sort()).toEqual(
      [...(PARTIAL_HQ_DOOR.MARKETING ?? [])].filter((h) => hrefs('MARKETING').includes(h)).sort(),
    );
    expect(hrefs('MARKETING')).toEqual(
      expect.arrayContaining(['/hq/loyalty', '/hq/customers', '/hq/campaigns']),
    );
    expect(hrefs('MARKETING')).not.toContain('/hq');
    expect(hrefs('MARKETING')).not.toContain('/hq/depots');
  });

  it('is not the console door: isHq and the landing page are unchanged', () => {
    expect(isHq('MARKETING')).toBe(false);
    expect(hasPartialHqDoor('MARKETING' as never)).toBe(true);
    expect(consoleHome('MARKETING', false)).toBe('/dashboard/campaigns');
  });

  it('refuses a typed URL outside the list', () => {
    expect(mayOpenHqPath('MARKETING' as never, '/hq/campaigns')).toBe(true);
    expect(mayOpenHqPath('MARKETING' as never, '/hq/customers/detail')).toBe(true);
    expect(mayOpenHqPath('MARKETING' as never, '/hq/depots')).toBe(false);
    expect(mayOpenHqPath('MARKETING' as never, '/hq')).toBe(false);
  });

  it('opens nothing for a depot manager, who is deliberately outside the console', () => {
    expect(hrefs('MANAGER')).toEqual([]);
    expect(hasPartialHqDoor('MANAGER' as never)).toBe(false);
    expect(mayOpenHqPath('MANAGER' as never, '/hq/depots')).toBe(false);
  });
});

describe('FINANCE has a door to its own work screens', () => {
  it('lists the four /dashboard finance screens', () => {
    expect(hrefs('FINANCE')).toEqual(
      expect.arrayContaining([
        '/dashboard/settlements',
        '/dashboard/expense-claims',
        '/dashboard/earning-rules',
        '/dashboard/cashbook',
      ]),
    );
  });
});
