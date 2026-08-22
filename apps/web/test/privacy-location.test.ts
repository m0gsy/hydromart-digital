import { describe, expect, it } from 'vitest';

import { privacy as en } from '@/lib/dictionaries/en/privacy';
import { privacy as id } from '@/lib/dictionaries/id/privacy';

/*
 * N1 — Play matches the Data Safety form against the privacy policy, and a form that
 * declares more than the policy is a takedown class, not a warning. The customer app
 * reads a coarse position (`lib/geo.ts`) and SENDS it to `depots.nearby` to pick the
 * serving depot, so "collected" is Play's answer, not ours. The policy used to declare
 * courier GPS only. This test is what keeps the two documents from drifting apart again:
 * both dictionaries must say the customer's own device location is collected, why, and
 * that refusing it still leaves the app usable.
 */
const body = (d: typeof id) => d.sections.map((s) => `${s.heading}\n${s.body}`).join('\n');

describe('privacy policy declares customer device location', () => {
  it('id discloses approximate device location, its purpose, and that it is optional', () => {
    const text = body(id);
    expect(text).toMatch(/lokasi perkiraan|perkiraan lokasi|lokasi perangkat/i);
    expect(text).toMatch(/depot terdekat/i);
    expect(text).toMatch(/opsional|tanpa memberi izin/i);
  });

  it('en mirrors it', () => {
    const text = body(en);
    expect(text).toMatch(/approximate location/i);
    expect(text).toMatch(/nearest depot/i);
    expect(text).toMatch(/optional|without granting/i);
  });

  it('both dictionaries carry the same sections', () => {
    expect(en.sections.map((s) => s.heading)).toHaveLength(id.sections.length);
  });
});
