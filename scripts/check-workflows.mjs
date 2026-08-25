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
   * M19/M20 — every workflow serialises against itself.
   *
   * `uat.yml` and `load.yml` each boot a whole eighteen-image stack and hold a runner for
   * ninety minutes, and neither had a `concurrency` block: a manual dispatch on top of the
   * scheduled run gave two of them at once. `registry-check.yml` gave two SSH sessions
   * probing the same production box. Nothing reported any of it, because a duplicate run
   * looks exactly like a run.
   */
  if (!('concurrency' in doc)) {
    problems.push(
      `${path}: no \`concurrency\` group — a dispatch on top of a scheduled run gives two of it at once`,
    );
  }

  /*
   * M17b — bake without cache keys is still a cold build.
   *
   * COMPOSE_BAKE only routes the build through buildx. The keys buildx then honours live in
   * docker-compose.cache.yml, which run.mjs layers on ONLY when COMPOSE_EXTRA_FILES names
   * it. Both scheduled stacks set the first and not the second, so each one built all
   * eighteen images from scratch while the cache `integration` had just filled sat unread —
   * and the plan's own note that these two "already set COMPOSE_BAKE" is what made it look
   * done.
   *
   * Read STRUCTURALLY, per step, not by grepping the file. The first version of this check
   * tested the raw text for `COMPOSE_EXTRA_FILES`, which the comment three lines above the
   * fix already contains — so it went green on a file with the variable deleted. Same defect
   * as the one it was written to catch: a gate that cannot go red. `run` bodies are stripped
   * of `#` comments for the same reason.
   */
  const uncommented = (run) => String(run ?? '').replace(/(^|\s)#[^\n]*/g, ' ');
  const envOf = (...scopes) => Object.assign({}, ...scopes.map((s) => s?.env ?? {}));
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      const env = envOf(doc, job, step);
      const body = uncommented(step?.run);
      if (!('COMPOSE_BAKE' in env) && !/COMPOSE_BAKE=/.test(body)) continue;
      const OVERLAY = 'docker-compose.cache.yml';
      const reached =
        String(env.COMPOSE_EXTRA_FILES ?? '').includes(OVERLAY) || body.includes(OVERLAY);
      if (!reached) {
        problems.push(
          `${path}: job \`${jobName}\` step \`${step.name ?? step.uses ?? '(unnamed)'}\` turns on ` +
            `COMPOSE_BAKE but never reaches ${OVERLAY} — buildx with no cache keys builds cold anyway`,
        );
      }
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

/*
 * N2/N7 — two build-time facts that are invisible until a release is already in the wild.
 *
 * N2: every NEXT_PUBLIC_* value is INLINED at build time, so a client error reporter that
 * is not passed to the build does not exist in the artefact, no matter how correct the
 * component is. It was correct, and no image and no APK ever carried it.
 *
 * N7: `run_number` does not move on a Re-run, and a re-run is the ordinary response to a
 * publish that failed after the bundle built — Play then rejects the identical versionCode.
 * Checked here rather than in a comment because the comment used to claim the opposite.
 */
const DSN = 'NEXT_PUBLIC_SENTRY_DSN';
const mobileText = readFileSync(join(DIR, 'mobile.yml'), 'utf8');
const imagesText = readFileSync(join(DIR, 'images.yml'), 'utf8');
const dockerfile = readFileSync(join(DIR, '..', '..', 'apps', 'web', 'Dockerfile'), 'utf8');
const compose = readFileSync(join(DIR, '..', '..', 'docker-compose.prod.yml'), 'utf8');

if (!dockerfile.includes(`ARG ${DSN}`)) {
  problems.push(`apps/web/Dockerfile: no \`ARG ${DSN}\` — the web image ships without a client error reporter`);
}
if (!compose.includes(`${DSN}:`)) {
  problems.push(`docker-compose.prod.yml: does not pass ${DSN} to the web build`);
}
if (!imagesText.includes(`${DSN}=`)) {
  problems.push(`${join(DIR, 'images.yml')}: does not pass ${DSN} to the published web image`);
}
const exportSteps = (mobileText.match(/npm run build:mobile/g) ?? []).length;
const mobileDsn = (mobileText.match(new RegExp(`${DSN}:`, 'g')) ?? []).length;
if (exportSteps > 0 && mobileDsn === 0) {
  problems.push(`${join(DIR, 'mobile.yml')}: exports the binaries without ${DSN} — every shipped APK is blind`);
}
if (!/run_attempt/.test(mobileText)) {
  problems.push(
    `${join(DIR, 'mobile.yml')}: versionCode ignores \`run_attempt\`, so a Re-run rebuilds a code Play has already seen`,
  );
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
