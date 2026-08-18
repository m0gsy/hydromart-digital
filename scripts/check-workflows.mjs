#!/usr/bin/env node
/**
 * Every workflow file parses, and every button a workflow implements is a button you can
 * actually press.
 *
 * Both halves are here because both happened in one commit. A block was inserted into the
 * middle of another input, producing DUPLICATE KEYS — and GitHub's failure mode for an
 * unparseable workflow is quiet in the worst way: the run appears, is marked failed, has
 * ZERO jobs, and the workflow is listed by its path instead of its name. Nothing says
 * "invalid YAML" anywhere a person looks first. Three red deploy runs on main said nothing
 * more specific than "failure".
 *
 * The second half is subtler and would have survived the first: two new `mode` values were
 * implemented in the script body and never added to the `choice` options, so the code was
 * there and the dropdown could not offer it. A button nobody can press is not a feature.
 *
 * Exit 0 = every workflow parses and its choices match its implementation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const DIR = '.github/workflows';
const problems = [];

for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const path = join(DIR, file);
  const text = readFileSync(path, 'utf8');
  let doc;
  try {
    // js-yaml rejects duplicate keys by default, which is the whole point: that is the
    // failure GitHub reports as an unnamed run with no jobs.
    doc = yaml.load(text);
  } catch (error) {
    problems.push(`${path}: does not parse — ${error.message.split('\n')[0]}`);
    continue;
  }
  if (!doc || typeof doc !== 'object') {
    problems.push(`${path}: parses to nothing`);
    continue;
  }
  if (!doc.name) {
    problems.push(`${path}: has no \`name\`, so Actions will list it by its path`);
  }
  // `on:` is the YAML 1.1 boolean `true` once parsed — its absence is what matters.
  if (!('on' in doc) && !(true in doc)) {
    problems.push(`${path}: has no \`on\` trigger`);
  }

  /*
   * Every job declares a time limit.
   *
   * GitHub's default is SIX HOURS. A CI run hung for over two of them on
   * `Install Playwright browser` — a download that normally takes under two minutes — with
   * all 45 preceding steps already green. Nothing failed and nothing alerted; the deploy
   * queue simply stopped. A hung job and a slow job look identical until a limit says which.
   */
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    if (job && typeof job === 'object' && !('timeout-minutes' in job) && !job.uses) {
      problems.push(`${path}: job \`${name}\` has no \`timeout-minutes\` — it can hang for six hours`);
    }
  }

  /*
   * A `choice` input whose options do not match the branches the script implements. Read
   * from the shell `case` labels in the same file: the workflow that dispatches on a mode
   * writes `mode)` for each one it handles, so the two lists are checkable against each
   * other without either being restated here.
   */
  const inputs = doc.on?.workflow_dispatch?.inputs ?? {};
  for (const [name, spec] of Object.entries(inputs)) {
    if (spec?.type !== 'choice' || !Array.isArray(spec.options)) continue;
    const cases = [...text.matchAll(/^\s{10,}([a-z][a-z-]*)\)\s+echo "run=/gm)].map((m) => m[1]);
    if (cases.length === 0) continue; // no case dispatch in this file; nothing to compare
    const offered = new Set(spec.options);
    const implemented = new Set(cases);
    for (const mode of implemented) {
      if (!offered.has(mode)) {
        problems.push(`${path}: \`${mode}\` is implemented but is not in \`${name}\` options — nobody can select it`);
      }
    }
    for (const mode of offered) {
      // The default branch (`*)`) covers anything not named, so an option with no case of
      // its own is legitimate — it falls through. Only report the reverse, which is dead UI.
      if (!implemented.has(mode) && !text.includes('*)')) {
        problems.push(`${path}: \`${mode}\` is offered in \`${name}\` but nothing implements it`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('Workflow files that would fail silently:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Workflow check OK — ${readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).length} file(s) parse, ` +
    'are named, and offer every mode they implement.',
);
