import { expect, test } from '@playwright/test';

import { loginWithOtp } from './helpers/auth';

/**
 * H2, the half that has to come first. `RATE_LIMIT_MAX=600`/min is not an API decision —
 * its own comment in `gateway-service/src/config/env.validation.ts` says it was raised to
 * accommodate a frontend defect: one HQ page fired ~201 requests on open (audit F-1).
 *
 * A limit sized around a bug protects nobody, and lowering it on the belief that the bug is
 * gone protects nobody either — it just moves the failure onto real customers as 429s. So
 * the belief becomes a measurement: open the pages, COUNT the API calls the browser makes,
 * and hold the number here.
 *
 * The budget is a ceiling with room, not a target. It fails when a page starts fanning out
 * again, which is the regression that produced the 600 in the first place; PR-7 and PR-8
 * batched those fan-outs and nothing has watched them since.
 */

/** Only calls that reach the gateway — assets, HMR and Next's own RSC traffic are not it. */
const isApiCall = (url: string) => /\/api\/v1\//.test(url);

async function countApiCalls(page: import('@playwright/test').Page, path: string) {
  const seen: string[] = [];
  const listener = (request: { url: () => string }) => {
    const url = request.url();
    if (isApiCall(url)) seen.push(url);
  };
  page.on('request', listener);
  await page.goto(path);
  // Settle: these screens fan out on mount, and networkidle is what "the page has finished
  // asking" means for a client-rendered console.
  await page.waitForLoadState('networkidle');
  page.off('request', listener);
  return seen;
}

/**
 * The audit's ~201 requests were measured on a network of TWELVE depots, and the fan-out it
 * measured was per depot. A seeded stack has three, so a small number here proves the storm
 * is gone for three depots and nothing at all about twelve — which is the size that mattered.
 *
 * So the depots are created first, through the API, with the console's own session. Twelve is
 * not a guess: it is the number the audit measured, so the before and after are comparable.
 */
const DEPOT_TARGET = 12;

/*
 * The API origin, which is NOT the baseURL.
 *
 * These calls used to be written as `page.request.get('/depots/...')`, which Playwright
 * resolves against `baseURL` — the NEXT app on :3000 (playwright.config.ts:10,26). Next has
 * no `/depots` route and no rewrite to one, so every call 404'd, `list.ok() ? … : []`
 * swallowed it, the twelve POSTs went to the same wrong origin unchecked, and CI printed
 *
 *   /hq: measuring across 0 depot(s)
 *
 * on every run. The whole point of this spec is to measure the fan-out AT THE SCALE the audit
 * measured it, and it was measuring an empty network while reporting a pass.
 */
const API_URL =
  process.env.E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const api = (path: string) => `${API_URL}${path}`;

async function ensureDepots(page: import('@playwright/test').Page): Promise<number> {
  const list = await page.request.get(api('/depots/api/v1/depots/manage?limit=100'));
  // Loud, not swallowed. An unreachable or unauthorised depot API is the exact condition
  // that made this spec measure nothing, so it must never be indistinguishable from
  // "there are no depots yet".
  if (!list.ok()) {
    throw new Error(
      `depot list failed (${list.status()}) at ${API_URL} — this spec cannot measure a ` +
        'fan-out without depots, and silently measuring zero is how it passed for months. ' +
        'Set E2E_API_URL to the gateway origin.',
    );
  }
  const existing = (await list.json()).items ?? [];
  const stamp = Date.now().toString().slice(-6);
  for (let i = existing.length; i < DEPOT_TARGET; i += 1) {
    // Spread far apart so none of them can compete for routing with a real seeded depot —
    // this spec measures request counts, and must not change what checkout would answer.
    const created = await page.request.post(api('/depots/api/v1/depots'), {
      data: {
        code: `BUDGET-${stamp}-${i}`,
        name: `Budget Depot ${i}`,
        ownershipType: 'HKP',
        address: 'Jl. Budget 1',
        city: 'Test',
        province: 'Test',
        lat: -2 - i * 0.5,
        lng: 118 + i * 0.5,
        serviceRadiusKm: 1,
        deliveryFee: 5000,
        minOrderAmount: 0,
      },
    });
    if (!created.ok()) {
      throw new Error(
        `creating budget depot ${i} failed (${created.status()}): ${await created.text()}`,
      );
    }
  }
  const after = await page.request.get(api('/depots/api/v1/depots/manage?limit=100'));
  if (!after.ok()) throw new Error(`depot re-read failed (${after.status()})`);
  const count = ((await after.json()).items ?? []).length;
  /*
   * The assertion that would have caught this on day one. A spec whose whole subject is
   * "at twelve depots" must refuse to report a number measured at fewer — a small count
   * here is not a small fan-out, it is an unmeasured one.
   */
  if (count < DEPOT_TARGET) {
    throw new Error(
      `only ${count} depot(s) exist, but this budget is defined at ${DEPOT_TARGET} — ` +
        'the audit measured ~201 requests at twelve, so anything less is not comparable.',
    );
  }
  return count;
}

test.describe('request budget per screen', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithOtp(page);
  });

  // The seeded account is a SUPER_ADMIN, so /hq is the console it lands in — and /hq is the
  // page the audit measured at ~201 requests.
  for (const { path, budget, atScale } of [
    /*
     * Measured, not guessed. The audit found ~201 requests on this page at twelve depots;
     * PR-7 took it to SIX, and the budget stayed at 80 — thirteen times the real number.
     * A ceiling that far above the floor cannot catch anything: the fan-out could come
     * two-thirds of the way back and still pass.
     *
     * 15 is the measurement plus room for a legitimate screen gaining a call or two. When
     * a real change needs more, raise it in the same commit and say why — that is the
     * conversation a ratchet exists to force.
     */
    { path: '/hq', budget: 15, atScale: true },
    { path: '/products', budget: 15, atScale: false },
  ]) {
    test(`${path} stays inside its request budget`, async ({ page }) => {
      const depots = atScale ? await ensureDepots(page) : 0;
      if (atScale) console.log(`${path}: measuring across ${depots} depot(s)`);
      const calls = await countApiCalls(page, path);
      // Printed on every run, pass or fail: the number is the point, and a budget nobody
      // can see the current value of is a budget nobody will ever tighten.
      console.log(`${path}: ${calls.length} API call(s), budget ${budget}`);
      const byPath = new Map<string, number>();
      for (const url of calls) {
        const key = new URL(url).pathname;
        byPath.set(key, (byPath.get(key) ?? 0) + 1);
      }
      const repeats = [...byPath.entries()].filter(([, n]) => n > 3).sort((a, b) => b[1] - a[1]);
      if (repeats.length)
        console.log('  repeated:', repeats.map(([p, n]) => `${p} ×${n}`).join(', '));
      expect(calls.length).toBeLessThanOrEqual(budget);
    });
  }
});
