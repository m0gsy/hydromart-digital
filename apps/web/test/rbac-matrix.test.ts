import { describe, expect, it } from 'vitest';

import { CAPABILITIES, type Capability } from '@hydromart/access';
import { CAP_SECTIONS } from '@/app/hq/access/rbac-matrix';
import { en } from '@/lib/dictionaries/en';
import { id } from '@/lib/dictionaries/id';

/**
 * The editor at /hq/access is only a single source of truth if it SHOWS the whole map.
 *
 * All 16 capabilities F2 added sat invisible here for a release: the guards enforced
 * them, the screen never listed them, and nothing failed — the matrix simply looked
 * complete. These two assertions are what would have caught that.
 */
describe('RBAC matrix coverage', () => {
  const listed = CAP_SECTIONS.flatMap((s) => s.caps);

  it('lists every capability the guards enforce, exactly once', () => {
    const caps = Object.keys(CAPABILITIES) as Capability[];
    expect([...listed].sort()).toEqual([...caps].sort());
  });

  it('has an id and en label for every listed capability and section', () => {
    for (const [locale, dict] of [
      ['id', id],
      ['en', en],
    ] as const) {
      const d = dict.hq.access;
      for (const cap of listed) {
        expect(d.caps, `${locale}.hq.access.caps.${cap}`).toHaveProperty(cap);
      }
      for (const section of CAP_SECTIONS) {
        expect(d.groups, `${locale}.hq.access.groups.${section.key}`).toHaveProperty(section.key);
      }
    }
  });
});
