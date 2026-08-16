import { describe, expect, it } from 'vitest';

import { HQ_GROUPS, hqItemsForRole } from '@/components/hq/hq-rail';

/*
 * Measured 2026-08-17 by a per-role browser sweep: DIREKTUR reached /hq and then 403'd on
 * 21 of its pages. The rail carried no capability gates at all — its own comment said the
 * console is "HEAD_OFFICE/SUPER_ADMIN-only via the layout gate", which stopped being true
 * the day DIREKTUR started reaching /hq. A director was offered twenty-one doors that open
 * onto an error message.
 *
 * The decision taken was NOT to widen: api keys, security policy, webhooks and retention are
 * `platformAdmin` on purpose, and catalog/tax/broadcast/roster are WRITE capabilities. A
 * director oversees; they do not rotate an API key or price the catalogue. So the door stops
 * being offered.
 *
 * This is the instrument for that half of the fix. The browser sweep cannot see it: it
 * navigates to every /hq route DIRECTLY, so it measures what the routes answer, never what
 * the console offers. Both halves need their own check or one of them goes unproven.
 */
describe('HQ rail offers a role only what it can use', () => {
  const hrefs = (role: string) => hqItemsForRole(role).map((i) => i.href);

  const CANNOT_USE = [
    // platformAdmin — SUPER_ADMIN only, and deliberately so.
    '/hq/api-keys',
    '/hq/security',
    '/hq/retention',
    '/hq/webhooks',
    '/hq/flags',
    // write capabilities over the catalogue, tax, audiences and the depot roster.
    '/hq/catalog',
    '/hq/tax',
    '/hq/invoice-template',
    '/hq/broadcast',
    '/hq/campaigns',
    '/hq/roster',
    '/hq/sla-policy',
    // RBAC editor and the PDP request desk.
    '/hq/access',
    '/hq/pdp',
  ];

  it.each(CANNOT_USE)('does not offer %s to a director', (href) => {
    expect(hrefs('DIREKTUR')).not.toContain(href);
  });

  // The other half, and the one that makes this a gate rather than a wall: the roles that
  // hold the capability still get every door.
  it('still offers all of them to a super admin', () => {
    const superAdmin = hrefs('SUPER_ADMIN');
    for (const href of CANNOT_USE) expect(superAdmin).toContain(href);
  });

  it('still offers head office the pages it holds the capability for', () => {
    const headOffice = hrefs('HEAD_OFFICE');
    // HEAD_OFFICE holds catalogWrite, taxSettings and audienceReach — but not platformAdmin.
    expect(headOffice).toContain('/hq/catalog');
    expect(headOffice).toContain('/hq/tax');
    expect(headOffice).toContain('/hq/broadcast');
    expect(headOffice).not.toContain('/hq/api-keys');
  });

  // A director is not locked out of the console — the overview and the reports they were
  // just granted stay, or this would have swapped one wrong answer for another.
  it('leaves the director the pages that are theirs', () => {
    const direktur = hrefs('DIREKTUR');
    expect(direktur).toContain('/hq');
    expect(direktur).toContain('/hq/analytics');
    expect(direktur.length).toBeGreaterThan(10);
  });

  // Every `cap` must name a capability the shared map actually knows: a typo would silently
  // hide a page from everyone, which is the same defect pointing the other way.
  it('tags items only with capabilities that exist', async () => {
    const { CAPABILITIES } = await import('@hydromart/access');
    for (const item of HQ_GROUPS.flatMap((g) => g.items)) {
      if (item.cap) expect(Object.keys(CAPABILITIES)).toContain(item.cap);
    }
  });
});
