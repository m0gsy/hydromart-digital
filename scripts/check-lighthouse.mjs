#!/usr/bin/env node
/**
 * PR-H / H3. Lighthouse as a RATCHET, not a report.
 *
 * A score nobody gates on is a score nobody reads. So the numbers this repo scores today
 * are recorded in `scripts/lighthouse-baseline.json` and a PR may not go below them (minus
 * one point of run-to-run noise). Where a page is already poor the floor is poor too —
 * that is honest, and it still stops it getting worse, which is the only thing a first
 * ratchet can promise.
 *
 *   node scripts/check-lighthouse.mjs                 # gate against the baseline
 *   node scripts/check-lighthouse.mjs --update        # re-record (deliberate, reviewable)
 *
 * Runs against a locally served build (BASE_URL, default http://localhost:3000) using the
 * Chromium Playwright already installed for the e2e job — the runner's own Chrome is a
 * moving target that would drift the numbers without anybody changing a line.
 *
 * Mobile emulation, which is what this product is: the customer app is a WebView on a
 * phone, and a desktop score would flatter every page in it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASELINE = 'scripts/lighthouse-baseline.json';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
/**
 * Run-to-run noise, per category — and `null` means NOT GATED.
 *
 * Performance is measured on a shared runner whose CPU is whatever the neighbours are
 * doing. Two runs of the SAME COMMIT, forty minutes apart, scored:
 *
 *   /          84 then 72
 *   /products  86 then 68
 *   /login     93 then 92
 *   /driver    77 then 83
 *
 * Eighteen points of spread with no code change. A floor on that is a gate that fails at
 * random, which teaches people to re-run until green — worse than no gate, because it
 * also devalues the three categories that ARE deterministic. So performance is measured
 * and printed on every run, and gated by nothing until it is measured somewhere stable.
 *
 * The other three are structural checks on the rendered page: label associations, contrast,
 * meta tags, HTTPS, console errors. They do not drift, and they are where a regression a
 * person can cause actually shows up.
 */
const TOLERANCE = {
  performance: null,
  accessibility: 1,
  'best-practices': 1,
  seo: 1,
};

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/** The pages a customer actually opens, plus the one a courier lives in. */
const PAGES = ['/', '/products', '/login', '/driver'];

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const { chromium } = require('playwright');
  return chromium.executablePath();
}

/** Start headless Chrome ourselves: chrome-launcher picks whatever it finds on the box. */
async function launchChrome(executable) {
  const port = 9222 + Math.floor(process.pid % 100);
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // Wait for the debugging endpoint rather than guessing at a sleep.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { port, kill: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('Chrome never opened its debugging port');
}

const lighthouse = (await import('lighthouse')).default;

const executable = await chromePath();
const chrome = await launchChrome(executable);
const measured = {};
try {
  for (const page of PAGES) {
    const result = await lighthouse(
      `${BASE_URL}${page}`,
      { port: chrome.port, output: 'json', logLevel: 'error' },
      undefined,
    );
    const scores = {};
    for (const category of CATEGORIES) {
      const raw = result.lhr.categories[category]?.score;
      scores[category] = raw === null || raw === undefined ? null : Math.round(raw * 100);
    }
    measured[page] = scores;
    console.log(
      `${page.padEnd(12)} ` +
        CATEGORIES.map((c) => `${c}=${scores[c] ?? '—'}`.padEnd(20)).join(' '),
    );
  }
} finally {
  chrome.kill();
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(`\nRecorded ${Object.keys(measured).length} page(s) as the new floor.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(
    `\nNo ${BASELINE}. Run with --update and commit it — a gate with no floor is not a gate.`,
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const failures = [];
for (const [page, scores] of Object.entries(measured)) {
  const floor = baseline[page];
  if (!floor) {
    failures.push(`${page} — no recorded floor. Run with --update and say why in the PR.`);
    continue;
  }
  for (const category of CATEGORIES) {
    const now = scores[category];
    const then = floor[category];
    if (then === null || then === undefined || now === null) continue;
    const slack = TOLERANCE[category];
    if (slack === null) continue; // measured and printed above, deliberately not gated
    if (now < then - (slack ?? 1)) {
      failures.push(`${page} ${category}: ${now} < ${then} (floor, tolerance ${slack ?? 1})`);
    }
  }
}

if (failures.length > 0) {
  console.error('\nLighthouse went backwards:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nLighthouse ratchet OK — no page below its recorded floor.');
