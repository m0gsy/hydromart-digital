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

  /*
   * Updated in step 07 of the console audit, and the reason matters more than the list.
   *
   * Two of these doors were closed to a director by a `cap` that was not the capability
   * the server enforces on the page at all: `/hq/roster` was gated on `tracking` (a depot
   * capability no HQ role holds, so the link was invisible to head office too, though
   * delivery-service serves them both) and `/hq/campaigns` on `audienceReach` (which a
   * director lacks, while `campaignRead` — what crm-service actually checks — they hold).
   * The rail was answering a different question from the server, and happening to land on
   * the right answer for one role.
   *
   * So the rule this file now holds is: **the rail offers exactly what the server would
   * serve**. Where a role should reach less than that, the place to say so is the
   * capability grant — `/hq/access` edits it live, without a deploy — not a gate naming an
   * unrelated capability. `/hq/roster` and `/hq/campaigns` are therefore offered to a
   * director, because `driverRoster` and `campaignRead` are theirs; if that is not the
   * intent, the fix is one row in the matrix.
   */
  const CANNOT_USE = [
    // platformAdmin — SUPER_ADMIN only, and deliberately so.
    '/hq/api-keys',
    '/hq/security',
    '/hq/retention',
    '/hq/webhooks',
    '/hq/flags',
    // Write capabilities a director does not hold: catalogue, tax, invoice template,
    // sending a broadcast (`campaignWrite`), and the depot SLA policy (`depotAdmin`).
    '/hq/catalog',
    '/hq/tax',
    '/hq/invoice-template',
    '/hq/broadcast',
    '/hq/sla-policy',
    // RBAC editor and the PDP request desk.
    '/hq/access',
    '/hq/pdp',
    // Added by step 07: the pages whose capability a director genuinely lacks and which
    // used to be offered anyway.
    '/hq/staff',
    '/hq/hierarchy',
    // NOT '/hq/customers': its lookup is `customerPhoneLookup`, which a director holds.
    '/hq/loyalty',
    '/hq/forms/pricing-rule',
    '/hq/forms/voucher',
    '/hq/forms/segment',
    '/hq/staff/import',
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
    // HEAD_OFFICE holds catalogWrite and taxSettings — but not platformAdmin.
    expect(headOffice).toContain('/hq/catalog');
    expect(headOffice).toContain('/hq/tax');
    expect(headOffice).not.toContain('/hq/api-keys');
    // Two doors head office had been denied by a gate naming the wrong capability: the
    // courier roster (`driverRoster`) and the depot onboarding checklist
    // (`depotDirectory`). Both are served to head office by their services.
    expect(headOffice).toContain('/hq/roster');
    expect(headOffice).toContain('/hq/onboarding');
    // And one it was offered but could not use: sending a broadcast is `campaignWrite`.
    expect(headOffice).not.toContain('/hq/broadcast');
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

/*
 * Step 07 — the other half. Hiding a link is a courtesy; the gate is what the page does
 * when somebody types the URL. `capForHqPath` is what `hq/layout.tsx` asks, and it reads
 * the SAME table the rail filters on, so a capability added to an item gates its page in
 * the same commit. 58 of the 64 /hq pages used to gate nothing at all.
 */
describe('capForHqPath', () => {
  it('answers with the item capability', async () => {
    const { capForHqPath } = await import('@/components/hq/hq-rail');
    expect(capForHqPath('/hq/api-keys')).toBe('platformAdmin');
    expect(capForHqPath('/hq/roster')).toBe('driverRoster');
  });

  it('carries the gate down to a detail screen', async () => {
    const { capForHqPath } = await import('@/components/hq/hq-rail');
    // /hq/depots/detail is not its own rail row; it inherits its parent's rule rather
    // than being the one unguarded way into depot data.
    expect(capForHqPath('/hq/staff/import')).toBe('staffAdmin');
    expect(capForHqPath('/hq/tax/anything/deeper')).toBe('taxSettings');
  });

  it('is null where the console gate is the whole rule', async () => {
    const { capForHqPath } = await import('@/components/hq/hq-rail');
    expect(capForHqPath('/hq')).toBeNull();
    expect(capForHqPath(null)).toBeNull();
    expect(capForHqPath('/somewhere/else')).toBeNull();
  });

  it('gives every gated rail item a page rule, and both agree', async () => {
    const { capForHqPath, HQ_GROUPS } = await import('@/components/hq/hq-rail');
    for (const item of HQ_GROUPS.flatMap((g) => g.items)) {
      if (!item.ready || !item.cap) continue;
      // If these two ever disagree, the rail hides a link whose page still opens.
      expect(capForHqPath(item.href)).toBe(item.cap);
    }
  });
});
