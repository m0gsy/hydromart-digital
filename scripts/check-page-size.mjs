#!/usr/bin/env node
/*
 * The web paginator must not ask for a page the server refuses.
 *
 * `apps/web/src/lib/fetch-all-pages.ts` shipped with `PAGE_SIZE = 200`. Every list DTO in
 * this repo caps `limit` at 100 (`@Max(100)`, 18 of 23 paginated DTOs, and all of the ones
 * this helper is pointed at). So every screen that used it answered
 *
 *   limit must not be greater than 100
 *
 * on its FIRST request — and the change that introduced it existed to lift a 100-row ceiling.
 * It turned a truncated list into an error page, on six screens, in production. Two were
 * reported; enumerating the call sites is what found the other four.
 *
 * Nothing caught it because every web test mocks `api.get`: the mock honours any limit you
 * like. The number is only wrong in the presence of the real validator, so the check has to
 * compare the two sides of the contract directly — which is all this file does.
 *
 * It also refuses to stay quiet about a caller it has never seen. The rule below is only
 * sound for endpoints whose cap was actually read; a new `fetchAllPages` call site pointed at
 * some other service is exactly the case where 100 might still be too many.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fails = 0;
const bad = (m) => {
  console.error(`FAIL ${m}`);
  fails += 1;
};
const ok = (m) => console.log(`ok   ${m}`);

const PAGINATOR = 'apps/web/src/lib/fetch-all-pages.ts';
const src = readFileSync(PAGINATOR, 'utf8');
const m = src.match(/export const PAGE_SIZE = (\d+)/);
if (!m) {
  bad(`${PAGINATOR} no longer exports a numeric PAGE_SIZE — this check cannot see the value`);
  process.exit(1);
}
const pageSize = Number(m[1]);

/*
 * Every `limit` field the services validate, with the ceiling each one enforces. Read from
 * the DTOs rather than from a list kept here, because a list kept here is a second thing to
 * remember and the first one to go stale.
 */
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.dto.ts')) out.push(p);
  }
  return out;
};

const caps = [];
for (const f of walk('services')) {
  const text = readFileSync(f, 'utf8');
  // The decorators sit immediately above the field, so the window before `limit?: number` is
  // where its own @Max lives. A file-wide search would pick up `page`'s @Max(1000) instead.
  const at = text.indexOf('limit?: number');
  if (at === -1) continue;
  const window = text.slice(Math.max(0, at - 400), at);
  const maxes = [...window.matchAll(/@Max\((\d+)\)/g)];
  if (maxes.length) caps.push({ file: f, max: Number(maxes[maxes.length - 1][1]) });
}

if (!caps.length) {
  bad('found no @Max on any `limit` DTO field — the check has lost its subject, not passed');
  process.exit(1);
}

/*
 * The call sites this rule has been verified against. Every one of them hits
 * `endpoints.products.browse` — product-service, cap 100.
 *
 * SIX, not the two that were reported. The bug was found on /dashboard/products/manage and
 * /hq/catalog; enumerating the callers is what turned up the other four, all broken the same
 * way and none of them mentioned. That is the argument for enumerating rather than trusting
 * the report.
 *
 * A seventh appearing is not a failure of the code — it is a question this file cannot answer
 * on its own, so it asks instead of assuming.
 */
const KNOWN_CALLERS = [
  'apps/web/src/app/dashboard/products/manage/page.tsx',
  'apps/web/src/app/hq/catalog/page.tsx',
  'apps/web/src/app/dashboard/inventory/new-line-form.tsx',
  'apps/web/src/app/dashboard/inventory/page.tsx',
  'apps/web/src/app/dashboard/pricing/page.tsx',
  'apps/web/src/app/dashboard/subscriptions/page.tsx',
];

const callers = [];
const walkWeb = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkWeb(p);
    // `fetchAllPages(` misses every real call site: they are all generic
    // (`fetchAllPages<Product>(`). The first version of this check matched that literal and
    // reported "0 caller(s), all verified" — a green line over a search that found nothing,
    // which is the same defect class as the bug it exists to catch.
    else if (/\.(tsx?|jsx?)$/.test(p) && /\bfetchAllPages\s*[<(]/.test(readFileSync(p, 'utf8'))) {
      callers.push(p.replace(/\\/g, '/'));
    }
  }
};
walkWeb('apps/web/src');
// The helper defines itself; it is not one of its own callers, and counting it made the
// pass line say 7 where there are 6.
const callSites = callers.filter((c) => c !== PAGINATOR);

const unknown = callSites.filter((c) => !KNOWN_CALLERS.includes(c));
if (unknown.length) {
  bad(
    'fetchAllPages has a caller this check has never seen. Read the @Max on the `limit` field ' +
      'of the DTO behind its endpoint, confirm PAGE_SIZE fits, then add it to KNOWN_CALLERS:',
  );
  for (const u of unknown) console.error(`       ${u}`);
} else {
  ok(`fetchAllPages has ${callSites.length} caller(s), all with a verified server cap`);
}

// product-service is what all the known callers hit, so its cap is the binding one.
const product = caps.find((c) => c.file.replace(/\\/g, '/').includes('product-service/'));
if (!product) {
  bad('product-service has no @Max on its list `limit` — the binding cap cannot be read');
} else if (pageSize > product.max) {
  bad(
    `PAGE_SIZE is ${pageSize} but ${product.file.replace(/\\/g, '/')} rejects any limit above ` +
      `${product.max}. Every screen using fetchAllPages fails on its first request.`,
  );
} else {
  ok(`PAGE_SIZE ${pageSize} is within the server cap of ${product.max}`);
}

// A page size above the smallest cap in the repo is not wrong today, but it is one endpoint
// away from being wrong, so say so without failing.
const smallest = caps.reduce((a, b) => (b.max < a.max ? b : a));
if (pageSize > smallest.max) {
  console.log(
    `note ${smallest.file.replace(/\\/g, '/')} caps limit at ${smallest.max}; PAGE_SIZE ` +
      `${pageSize} would be refused there. Fine while nothing pages that endpoint.`,
  );
}

process.exit(fails ? 1 : 0);
