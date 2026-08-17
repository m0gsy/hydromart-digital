#!/usr/bin/env node
/**
 * PR-J, part four: the offline evaluation. Every model registered in forecast-service,
 * walk-forward against the moving-average baseline, on real series pulled from a running
 * stack (or on a JSON file of series, for a machine with no stack).
 *
 *   GATEWAY_URL=http://localhost:8080 JWT_ACCESS_SECRET=<secret> node scripts/forecast-eval.mjs
 *   node scripts/forecast-eval.mjs --file series.json      # [{ "label": "...", "series": [..] }]
 *
 * Read-only. It fetches history and computes; it never writes a forecast, a setting or a
 * row. Turning a winner on is a separate, deliberate act: the per-depot setting, in the
 * console, one depot at a time.
 *
 * Why this exists before any fitted model does: the day someone proposes one, the question
 * will be "is it better than what we have", and the honest answer needs a harness that was
 * written BEFORE anyone had a favourite. It also answers a question nobody has asked yet —
 * whether the heuristic in production beats a flat average at all.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : null;
const MIN_TRAIN = Number(process.env.MIN_TRAIN ?? 7);
const MA_WINDOW = Number(process.env.MA_WINDOW ?? 7);

/*
 * The models and the metrics come from forecast-service's own compiled domain, never from
 * a copy living here. A harness that reimplements the thing it measures eventually measures
 * its own reimplementation — and reports that the production model is fine.
 */
const require = createRequire(import.meta.url);
let baselineModel;
let MODELS;
let compare;
let churn;
try {
  ({ baselineModel, MODELS } = require('../services/forecast-service/dist/src/domain/models.js'));
  ({ compare } = require('../services/forecast-service/dist/src/domain/evaluate.js'));
  churn = {
    ...require('../services/forecast-service/dist/src/domain/churn-models.js'),
    ...require('../services/forecast-service/dist/src/domain/churn-evaluate.js'),
  };
} catch {
  console.error('Build the service first: npm run build --workspace @hydromart/forecast-service');
  process.exit(1);
}

function staffToken() {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required (or use --file)');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: crypto.randomUUID(),
    role: 'SUPER_ADMIN',
    phone: '+620000000000',
    iat: now,
    exp: now + 900,
  })}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

/** Every depot's revenue history — one series per depot, which is what a depot's model sees. */
async function seriesFromStack() {
  const token = staffToken();
  const get = async (path) => {
    const res = await fetch(`${GATEWAY}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const depots = (await get('/depots/api/v1/depots/manage?limit=100')).items ?? [];
  const out = [];
  for (const depot of depots) {
    const forecast = await get(
      `/forecast/api/v1/forecast/sales?depotId=${depot.id}&historyDays=90&horizonDays=7`,
    );
    if ((forecast.history ?? []).length > MIN_TRAIN) {
      out.push({ label: `${depot.code} revenue`, series: forecast.history });
    }
  }
  return out;
}

const datasets = FILE ? JSON.parse(readFileSync(FILE, 'utf8')) : await seriesFromStack();
if (datasets.length === 0) {
  console.log('No series with enough history to score. Nothing measured, nothing claimed.');
  process.exit(0);
}

const candidates = MODELS.filter((m) => m.name !== baselineModel.name);
const totals = new Map(candidates.map((m) => [m.name, { wins: 0, scored: 0 }]));

for (const { label, series } of datasets) {
  const result = compare(series, baselineModel, candidates, {
    minTrain: MIN_TRAIN,
    maWindow: MA_WINDOW,
  });
  console.log(
    `\n${label} — ${series.length} days, ${result.baseline.n} scored, ${result.baseline.zeroDays} with no sales`,
  );
  console.log(
    `  ${'model'.padEnd(16)} ${'MAE'.padStart(9)} ${'MAPE%'.padStart(8)} ${'bias'.padStart(8)}   vs baseline`,
  );
  const line = (m, delta) =>
    `  ${m.model.padEnd(16)} ${String(m.mae).padStart(9)} ${String(m.mape ?? '—').padStart(8)} ${String(m.bias).padStart(8)}   ${delta}`;
  console.log(line(result.baseline, 'baseline'));
  for (const c of result.candidates) {
    const better = c.maeDeltaPct < 0;
    const tally = totals.get(c.model);
    tally.scored += 1;
    if (better) tally.wins += 1;
    console.log(
      line(c, `${better ? 'BETTER' : 'worse '} ${c.maeDeltaPct > 0 ? '+' : ''}${c.maeDeltaPct}%`),
    );
  }
}

console.log('\nAcross every series:');
for (const [model, { wins, scored }] of totals) {
  console.log(`  ${model}: beats the moving average on ${wins}/${scored}`);
}
console.log(
  '\nA win here is a reason to try a depot, not a reason to switch everyone: set\n' +
    '  FORECAST_MODEL_BY_DEPOT={"<depotId>":"<model>"}\n' +
    'and measure that depot against the one next door.',
);

/*
 * The churn half. Its metric is AUC, not error: a churn score is only ever used to SORT an
 * outreach list, so what matters is whether the customers who actually lapsed are ranked
 * above the ones who did not. 0.5 is a coin toss — a model there sorts the list at random.
 *
 * Needs order history per customer, which the stack does not expose in one call, so it runs
 * only from --file: [{ "label": "...", "customers": [{ "orders": [{ "at": "...", "total": 0 }] }] }]
 */
const churnSets = datasets.filter((d) => Array.isArray(d.customers));
if (churnSets.length > 0) {
  const cut = new Date(process.env.CHURN_CUT ?? datasets[0].cut);
  const horizon = Number(process.env.CHURN_HORIZON_DAYS ?? 30);
  const opts = {
    windowDays: Number(process.env.CHURN_WINDOW_DAYS ?? 60),
    monetaryRef: Number(process.env.CHURN_MONETARY_REF ?? 0),
  };
  const candidates = churn.CHURN_MODELS.filter((m) => m.name !== churn.recencyOnlyChurnModel.name);
  for (const set of churnSets) {
    const samples = churn.buildChurnSamples(
      set.customers.map((c) => ({
        orders: c.orders.map((o) => ({ at: new Date(o.at), total: o.total })),
      })),
      cut,
      horizon,
    );
    const result = churn.compareChurn(
      samples,
      churn.recencyOnlyChurnModel,
      candidates,
      new Date(cut),
      opts,
    );
    console.log(
      `\n${set.label} — ${result.baseline.n} customer(s), ${result.baseline.churned} lapsed within ${horizon}d`,
    );
    console.log(`  ${'model'.padEnd(16)} ${'AUC'.padStart(7)}   vs baseline`);
    console.log(
      `  ${result.baseline.model.padEnd(16)} ${String(result.baseline.auc ?? '—').padStart(7)}   baseline`,
    );
    for (const c of result.candidates) {
      const better = (c.aucDelta ?? 0) > 0;
      console.log(
        `  ${c.model.padEnd(16)} ${String(c.auc ?? '—').padStart(7)}   ` +
          (c.aucDelta === null
            ? 'not comparable'
            : `${better ? 'BETTER' : 'worse '} ${c.aucDelta > 0 ? '+' : ''}${c.aucDelta}`),
      );
    }
  }
}

/*
 * PR-J item 3, named rather than left as "later": a fitted model is worth attempting when a
 * depot has NINETY DAYS of completed orders and at least 200 of them. Below that the
 * backtest above is scoring noise — the restore drill still reports `hydromart_forecast: no
 * rows live`, and a model fitted on that would be confidently worse than the average it
 * replaced. When a depot crosses it, run this harness on that depot and let the numbers,
 * not the calendar, decide.
 */
console.log(
  '\nFit trigger: 90 days of completed orders AND at least 200 of them, per depot. Until a\n' +
    'depot crosses both, the heuristic keeps running and this harness is measuring noise.',
);
