#!/usr/bin/env node
/**
 * Every page has to be visited by the role browser pass, and the pass may not visit a page that
 * does not exist.
 *
 * The route lists in `scripts/role-browser-pass.mjs` are written by hand, and nothing tied them to
 * `apps/web/src/app`. Two things followed, and both were found by reading the results rather than
 * by any check:
 *
 *   - two routes (`/dashboard/products`, `/dashboard/promotions/detail`) were listed with no
 *     `page.tsx`. They answered 404 on every run and were read as broken screens;
 *   - 42 of 234 pages were in no list at all, among them the whole HR desk (32 pages) — the pass had
 *     no HR role — plus the kasbon screen a push notification lands on. Nobody had ever opened them
 *     in a browser under CI, and a new page added to any console would have joined them silently.
 *
 * This is the cheap half of that guarantee: it needs no browser and no stack, only the two file
 * trees. It says nothing about whether a page RENDERS — the pass does that — only that the pass is
 * being asked about every page there is.
 *
 *   node scripts/check-sweep-coverage.mjs            # gate
 *   node scripts/check-sweep-coverage.mjs --list     # print the page and route counts
 *
 * Exit 0 = every page is swept or explicitly exempt, and every swept route has a page.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PASS = arg('--pass', 'scripts/role-browser-pass.mjs');
const APP = arg('--app', 'apps/web/src/app');

/**
 * Pages the pass does not open, each with the reason. Not an excuse list: an entry has to be a
 * page that exists and that no route list names, or this fails — so it cannot outlive its reason.
 */
const EXEMPT = {
  '/hq/login':
    'the sign-in page itself. The pass signs in first, and a page that bounces to a login route ' +
    'aborts the run, so an authenticated visit here measures nothing',
};

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};

// Route groups — `(shop)` — are folders that add no URL segment.
const pages = new Set(
  walk(APP)
    .filter((f) => f.endsWith('/page.tsx'))
    .map((f) => f.slice(APP.length, -'/page.tsx'.length).replace(/\/\([^)]*\)/g, '') || '/'),
);

const src = readFileSync(PASS, 'utf8');
const lists = {};
for (const m of src.matchAll(/const ([A-Z]+) = R\(`([^`]*)`\)/g)) {
  lists[m[1]] = m[2].split(/\s+/).filter(Boolean);
}
if (Object.keys(lists).length < 5) {
  console.error(`Sweep coverage check: found only ${Object.keys(lists).length} route list(s) in ${PASS}. ` +
    'The lists are read as `const NAME = R(`…`)`; if that shape changed, change this reader with it.');
  process.exit(1);
}

const listed = new Set(Object.values(lists).flat());
const problems = [];

for (const [name, routes] of Object.entries(lists)) {
  for (const r of routes) {
    if (!pages.has(r)) problems.push(`${name} lists ${r}, which has no page.tsx — it will 404 on every run and read as a broken screen`);
  }
}
for (const p of [...pages].sort()) {
  if (!listed.has(p) && !(p in EXEMPT)) problems.push(`${p} is a page no sweep list visits — add it to the list for the role that opens it, or exempt it here with a reason`);
}
for (const p of Object.keys(EXEMPT)) {
  if (!pages.has(p)) problems.push(`EXEMPT names ${p}, which is not a page any more — delete the entry`);
  else if (listed.has(p)) problems.push(`EXEMPT names ${p}, but a sweep list visits it — delete the entry`);
}

if (process.argv.includes('--list')) {
  console.log(`${pages.size} pages; ${listed.size} routes in ${Object.keys(lists).length} lists (${Object.entries(lists).map(([k, v]) => `${k} ${v.length}`).join(', ')}); ${Object.keys(EXEMPT).length} exempt`);
}
if (problems.length > 0) {
  console.error(`Sweep coverage check FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Sweep coverage check OK — ${pages.size} pages, every one swept or exempt; ${listed.size} swept routes, every one a real page.`);
