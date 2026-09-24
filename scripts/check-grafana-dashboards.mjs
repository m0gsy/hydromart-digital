#!/usr/bin/env node
/**
 * The provisioned Grafana dashboards must be readable by Grafana and ask questions Prometheus
 * can answer.
 *
 *   node scripts/check-grafana-dashboards.mjs            # checks ops/grafana-dashboards/*.json
 *
 * A dashboard nobody has ever opened can be wrong in the quietest ways: JSON that parses but
 * points at a datasource that does not exist, a panel whose query names a metric no service
 * emits (Grafana draws an empty graph, which reads exactly like "nothing is wrong"), or a
 * route selector for a route that is not there — the mistake that made NoOrdersCreated fire on
 * nothing. This checks the parts that can be checked without a running Grafana:
 *
 *   - valid JSON with a uid and a title, and unique panel ids;
 *   - a `ds` datasource variable, and every panel (and target) using it — no hard-coded uid,
 *     which would break the day the datasource is re-provisioned;
 *   - every panel has at least one target with a non-empty expression;
 *   - every metric a query names is one this platform really exposes (the allowlist below, each
 *     with the place that emits it);
 *   - route selectors are checked against the controllers by check-alert-routes.mjs, and the
 *     PromQL itself is parsed by promtool in check-grafana-dashboards.test.sh.
 *
 * Exit 0 = every dashboard passes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR =
  process.env.GRAFANA_DASHBOARDS_DIR ??
  join(process.env.HYDROMART_ROOT ?? process.cwd(), 'ops/grafana-dashboards');

/** Metric name prefixes and the exporter that produces them. */
const METRICS = [
  ['up', 'Prometheus itself, one series per scrape target'],
  [
    'http_request_duration_seconds',
    'enableMetrics() in packages/platform (histogram: _bucket/_count/_sum)',
  ],
  ['nodejs_eventloop_lag_seconds', 'prom-client default metrics, via enableMetrics()'],
  ['client_app_requests_total', 'enableMetrics(): installed app package and build'],
  ['node_', 'node-exporter (docker-compose.prod.yml)'],
  ['container_', 'cAdvisor (docker-compose.prod.yml)'],
  ['pg_', 'postgres-exporter (docker-compose.prod.yml)'],
];
const FUNCTIONS = new Set(['histogram_quantile']);

const isKnown = (name) =>
  FUNCTIONS.has(name) || METRICS.some(([prefix]) => name === prefix || name.startsWith(prefix));

/** Names in an expression that look like metrics: no label blocks, no quoted strings, no `by (...)`. */
function metricNames(expr) {
  const bare = expr
    .replace(/"[^"]*"/g, '""')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, '');
  return [...new Set(bare.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/g) ?? [])].filter(
    (n) => n === 'up' || n.includes('_'),
  );
}

const problems = [];
const say = (file, text) => problems.push(`${file}: ${text}`);

let files = [];
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
} catch {
  problems.push(`${DIR}: no dashboards directory — the Grafana mount would be empty`);
}
if (files.length === 0 && problems.length === 0) problems.push(`${DIR}: no dashboards`);

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (error) {
    say(file, `is not valid JSON (${error.message})`);
    continue;
  }
  if (!doc.uid) say(file, 'has no uid');
  if (!doc.title) say(file, 'has no title');
  const vars = doc.templating?.list ?? [];
  if (!vars.some((v) => v.name === 'ds' && v.type === 'datasource')) {
    say(file, 'has no `ds` datasource variable — panels would need a hard-coded datasource uid');
  }

  const ids = new Set();
  let queries = 0;
  for (const panel of doc.panels ?? []) {
    if (ids.has(panel.id)) say(file, `panel id ${panel.id} is used twice`);
    ids.add(panel.id);
    if (panel.type === 'row') continue;
    const title = panel.title ?? `#${panel.id}`;
    if (panel.datasource?.uid !== '${ds}') {
      say(file, `panel "${title}" does not use the \${ds} datasource variable`);
    }
    if (!panel.targets?.length) say(file, `panel "${title}" has no query`);
    for (const target of panel.targets ?? []) {
      queries += 1;
      if (target.datasource?.uid !== '${ds}') {
        say(file, `panel "${title}" has a query outside the \${ds} datasource variable`);
      }
      if (!String(target.expr ?? '').trim()) {
        say(file, `panel "${title}" has an empty query`);
        continue;
      }
      for (const name of metricNames(target.expr)) {
        if (!isKnown(name))
          say(file, `panel "${title}" queries "${name}", which nothing here exports`);
      }
    }
  }
  if (queries === 0) say(file, 'has no queries at all');
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in the Grafana dashboards:\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `check-grafana-dashboards: ${files.length} dashboard(s) are provisionable and query real metrics`,
);
