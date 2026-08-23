#!/usr/bin/env node
/**
 * M26: the deploy must ship the commit whose CI went green.
 *
 * The gate in deploy.yml checks its TRIGGER — `workflow_run.conclusion == 'success'` — while
 * deploy.sh chose its own target with `git rev-parse origin/main`. What actually held was
 * "some commit is green", never "this commit is green". Measured in production on
 * 2026-08-22: #230 merged 16:30, #232 merged 16:57, CI(#230) went green 17:13, and the
 * deploy it fired shipped #232 — which then ran for 41 minutes under another commit's CI.
 * The realistic failure is not a red PR (nobody merges one); it is two PRs green apart and
 * red together, which two of that day's PRs actually were on e2e.
 *
 * The wiring that closes it is four small things in two files, and every one of them is
 * invisible to every other gate here: YAML is a string to shellcheck, and the shell is a
 * string to actionlint. So this checks the contract itself.
 *
 *   node scripts/check-deploy-sha.mjs
 *
 * Exit 0 = the green-SHA path is wired; 1 = one end of it is missing.
 */
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const script = readFileSync('scripts/deploy.sh', 'utf8');

const problems = [];
const need = (haystack, pattern, where, why) => {
  if (!pattern.test(haystack)) problems.push(`${where}: ${why}`);
};

need(
  workflow,
  /DEPLOY_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/,
  '.github/workflows/deploy.yml',
  'DEPLOY_SHA is not set from `github.event.workflow_run.head_sha` — the deploy would pick its own target again',
);
need(
  workflow,
  /envs:[^\n]*\bDEPLOY_SHA\b/,
  '.github/workflows/deploy.yml',
  'DEPLOY_SHA is not listed in the ssh-action `envs:` — it would never reach the box',
);
need(
  script,
  /NEW_SHA="\$\{DEPLOY_SHA:-\$TIP_SHA\}"/,
  'scripts/deploy.sh',
  'the target is not `${DEPLOY_SHA:-$TIP_SHA}` — a green SHA handed in would be ignored',
);
need(
  script,
  /merge-base --is-ancestor "\$NEW_SHA" "\$PREV_SHA"/,
  'scripts/deploy.sh',
  'the backwards guard is gone — CI finishes out of order, and an older green SHA would roll production back with nothing to explain it',
);
need(
  script,
  /merge-base --is-ancestor "\$NEW_SHA" "\$TIP_SHA"/,
  'scripts/deploy.sh',
  'nothing checks that DEPLOY_SHA is actually on the branch — a stale or foreign SHA would be deployed',
);

if (problems.length > 0) {
  console.error('deploy SHA contract BROKEN:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee M26. The deploy is the one place where a wrong commit is invisible:');
  console.error('the workflow goes green either way, and the box says nothing.');
  process.exit(1);
}

console.log('deploy SHA contract OK — the deploy ships the commit whose CI went green.');
