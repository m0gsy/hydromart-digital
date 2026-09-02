import { describe, expect, it } from 'vitest';

import { HQ_GROUPS, hqGroupsForRole, hqItemsForRole } from '@/lib/hq-nav';

/**
 * What each role is actually offered in the HQ console.
 *
 * A browser pass signed in as a real HEAD_OFFICE — the first time such an account existed —
 * found 28 of the 63 HQ routes answering 403. Six of those are platform administration
 * (`platformAdmin`, SUPER_ADMIN only) and are meant to stay that way: the fault was not the
 * gate but the nav offering them to every role the console admits. A menu entry that can
 * only ever fail reads as a broken system, not as a permission boundary.
 *
 * The sweep cannot prove this half — it navigates by URL, so it still reaches a hidden
 * page and still sees the server refuse it, which is correct. The claim that needs holding
 * is about the MENU, and that is what these assert.
 */
const PLATFORM_ADMIN_ONLY = [
  '/hq/api-keys',
  '/hq/flags',
  '/hq/retention',
  '/hq/security',
  '/hq/webhooks',
  '/hq/wizard',
];

const hrefs = (role: string) => hqItemsForRole(role).map((i) => i.href);

describe('HQ nav per role', () => {
  it('offers a super admin every ready screen', () => {
    const ready = HQ_GROUPS.flatMap((g) => g.items).filter((i) => i.ready).length;
    expect(hqItemsForRole('SUPER_ADMIN')).toHaveLength(ready);
  });

  it.each(['HEAD_OFFICE', 'DIREKTUR'])('hides the platform-admin screens from %s', (role) => {
    const visible = hrefs(role);
    for (const href of PLATFORM_ADMIN_ONLY) {
      expect(visible).not.toContain(href);
    }
    // ...and still offers the console it exists for, rather than hiding half of it.
    expect(visible).toContain('/hq');
    expect(visible).toContain('/hq/depots');
    expect(visible).toContain('/hq/reconciliation');
  });

  it('shows the platform-admin screens to a super admin', () => {
    const visible = hrefs('SUPER_ADMIN');
    for (const href of PLATFORM_ADMIN_ONLY) {
      expect(visible).toContain(href);
    }
  });

  it('gives a non-HQ role no menu at all', () => {
    for (const role of ['KEPALA_DEPOT', 'STAFF_DEPOT', 'CUSTOMER', null, undefined]) {
      expect(hqGroupsForRole(role as string)).toEqual([]);
    }
  });

  // A group whose every item is filtered out must not render as an empty heading.
  it('drops groups that end up with no items', () => {
    for (const role of ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN']) {
      for (const group of hqGroupsForRole(role)) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});
