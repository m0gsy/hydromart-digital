#!/usr/bin/env node
/**
 * An alert may only select a route that exists.
 *
 *   node scripts/check-alert-routes.mjs
 *
 * NoOrdersCreated and CheckoutFailing selected a route ending in `/orders` with method POST. No
 * such route exists — orders are created at `/orders/checkout` and `/orders/walk-in` — so
 * the first fired every business day whatever was ordered (`or vector(0)` turned "no series"
 * into a zero) and the second divided nothing by nothing and could never fire. Both sat in
 * ops/alert-rules.yml, and promtool passed, because the fixtures in alert-rules.test.yml
 * wrote the same invented label: a rule and a test that agree with each other and with
 * nothing else.
 *
 * So two things are checked against the controllers themselves:
 *   1. every `route` matcher in ops/alert-rules.yml matches at least one real route (and, when
 *      the same selector names a `method`, a route with that method);
 *   2. every `route` label in the promtool fixtures IS a real route.
 *
 * The label is req.route.path, `/api/v1/<controller>/<route>` (see scripts/lib/route-inventory.mjs).
 * Exit 0 = every alert selector and fixture label names a route that exists.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, controllers, routePattern } from './lib/route-inventory.mjs';

const RULES = process.env.ALERT_RULES ?? join(ROOT, 'ops/alert-rules.yml');
const TESTS = process.env.ALERT_TESTS ?? join(ROOT, 'ops/alert-rules.test.yml');

const routes = controllers().flatMap((c) =>
  c.routes.map((r) => ({ ...r, service: c.service, re: routePattern(r.full) })),
);

/** Full-line comments removed: prose quotes selectors while explaining why they were wrong. */
const code = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

/** `{a="b", c=~"d"}` blocks that carry a `route` matcher, as [{ op, value }] per label. */
function selectors(text) {
  const out = [];
  for (const block of text.matchAll(/\{([^{}]*route\s*(?:=~|=)[^{}]*)\}/g)) {
    const labels = {};
    for (const m of block[1].matchAll(/(\w+)\s*(=~|!~|!=|=)\s*"([^"]*)"/g)) {
      labels[m[1]] = { op: m[2], value: m[3] };
    }
    if (labels.route) out.push({ text: block[0], labels });
  }
  return out;
}

const matches = (matcher, actual) => {
  if (matcher.op === '=') return actual === matcher.value;
  if (matcher.op === '=~') return new RegExp(`^(?:${matcher.value})$`).test(actual);
  return true; // a negative matcher selects everything else; nothing to prove
};

const problems = [];
for (const [file, label] of [
  [RULES, 'alert rule'],
  [TESTS, 'fixture'],
]) {
  for (const sel of selectors(code(file))) {
    const { route, method } = sel.labels;
    if (route.op === '!~' || route.op === '!=') continue;
    const real = routes.filter(
      (r) => matches(route, r.full) && (!method || matches(method, r.method)),
    );
    if (real.length === 0) {
      problems.push(
        `${label}: ${sel.text.replace(/\s+/g, ' ')} matches no route the services declare`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} selector(s) name a route that does not exist:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nThe label is req.route.path: /api/v1/<controller path>/<route path>. An alert built on a\n' +
      'route that is not there fires on nothing — or, with `or vector(0)`, on everything.',
  );
  process.exit(1);
}
console.log(
  `check-alert-routes: every route selector matches a real route (${routes.length} routes known)`,
);
