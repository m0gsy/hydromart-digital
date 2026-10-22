import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every `api.<verb>(...)` that does NOT pass `auth = true` leaves without an Authorization header.
 *
 * On the web that is invisible: the gateway reads the session cookie and attaches the bearer
 * itself. In the native shell (Ops, Customer, Courier) there is no cookie, so the same call
 * reaches a guarded route with no credential at all and comes back as "Missing bearer token" -
 * on an account that is signed in. `reschedule-sheet` shipped exactly that way: a SelfScoped
 * route called without the flag, working in every browser test and failing on every phone.
 *
 * So the set of calls allowed to be unauthenticated is written down here, each one a route that
 * is @Public on the server (checked against the running gateway when this list was made). A new
 * unauthenticated call fails this test until somebody confirms the route is public and adds it.
 */

const SRC = join(__dirname, '..', 'src');

/** First argument of each call, as written. Public on the server; add with evidence only. */
const PUBLIC_CALLS = new Set([
  'endpoints.admin.publicFlags',
  'endpoints.auth.login',
  'endpoints.auth.register',
  'endpoints.auth.resendOtp',
  'endpoints.auth.verifyOtp',
  'endpoints.franchiseApps.submit',
  'endpoints.orders.track(token)',
  'endpoints.payments.methods',
  'endpoints.promotions.list',
  'endpoints.referrals.rules',
  'endpoints.rewards.catalog',
  'endpoints.subscriptions.discount(depotId)',
]);

/** Public-route PREFIXES: the argument is a builder call, so match by the endpoint it builds. */
const PUBLIC_PREFIXES = [
  'endpoints.depots.browse(',
  'endpoints.depots.nearby(',
  'endpoints.inventory.prices(',
  'endpoints.loyalty.rules(',
  'endpoints.loyalty.tiers(',
  'endpoints.products.',
  'endpoints.recommendations.related(',
  'endpoints.recommendations.trending(',
];

/**
 * Call sites whose first argument is a variable, so the endpoint cannot be read from the call.
 * Each one decides `auth` at run time and is reviewed by hand:
 *  - product-rec-rail passes `requiresAuth` computed from which rail it is drawing.
 *  - lib/endpoints/hr.ts is a comment about `api.get(endpoints.hr.employees...)`, not a call.
 */
const DYNAMIC_OK = new Set(['endpoint', 'endpoints.hr.employees…']);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function unauthenticatedCalls(): { where: string; first: string }[] {
  const found: { where: string; first: string }[] = [];
  const re = /\bapi\.(get|getCached|post|put|patch|del)\s*(?:<[^>(]*>)?\(/g;
  for (const file of sources(SRC)) {
    const s = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      let i = re.lastIndex;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const c = s[i++];
        if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
      }
      const args = s.slice(re.lastIndex, i - 1);
      let d = 0;
      let flat = '';
      for (const c of args) {
        if ('([{'.includes(c)) d += 1;
        else if (')]}'.includes(c)) d -= 1;
        else if (d === 0) flat += c;
      }
      if (/(^|,)\s*true\s*(,|$)/.test(flat)) continue;
      const line = s.slice(0, m.index).split('\n').length;
      const first = args.split(/,(?![^(]*\))/)[0]?.trim() ?? '';
      found.push({ where: `${relative(SRC, file)}:${line}`, first });
    }
  }
  return found;
}

describe('calls that go out without a bearer token', () => {
  const calls = unauthenticatedCalls();

  it('finds the calls it is meant to police (the scan is not vacuous)', () => {
    expect(calls.length).toBeGreaterThan(30);
  });

  it('every one of them is a route known to be public', () => {
    const unknown = calls.filter(
      ({ first }) =>
        !PUBLIC_CALLS.has(first) &&
        !DYNAMIC_OK.has(first) &&
        !PUBLIC_PREFIXES.some((p) => first.startsWith(p)),
    );
    expect(
      unknown.map((u) => `${u.where}  ${u.first}`),
      'these calls send no Authorization header on a phone; pass auth = true, or add the route here with proof that it is @Public',
    ).toEqual([]);
  });

  it('the one that was wrong is now authenticated', () => {
    expect(calls.some((c) => c.first.startsWith('endpoints.orders.deliveryOptions'))).toBe(false);
  });
});
