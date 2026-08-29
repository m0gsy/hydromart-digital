/**
 * The business timezone, alone in its own module.
 *
 * It lives here rather than in `wib.ts` because of what importing it COSTS. `wib.ts` builds
 * `Intl.DateTimeFormat` instances at module scope; pulling the constant out of it pulls those
 * in too. `opening-hours.ts` needs the zone and nothing else, and it is on the home page —
 * the one page whose request count already sits one below its ratchet ceiling.
 *
 * Still exactly one definition. `wib.ts` re-exports this, so every existing importer is
 * unchanged and there is no second string to drift from the first — which is the whole reason
 * the constant exists instead of 'Asia/Jakarta' typed in nine places.
 */
export const BUSINESS_TZ = 'Asia/Jakarta';
