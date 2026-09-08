#!/usr/bin/env node
/**
 * No tracked file may carry a merge-conflict marker.
 *
 * Why this exists: on 2026-09-08 four PRs were merged in quick succession, each rebased on
 * the last. The rebase helper resolving them ran `git add -A` and THEN asked
 * `git diff --diff-filter=U` whether anything was still conflicted — but `git add` clears
 * the unmerged state, so the answer was always "no" and files were committed with
 * `<<<<<<<` still in them. Two dictionaries and two components reached `main` that way.
 *
 * Nothing caught it. `tsc` would have, but the merges went in faster than CI could run, and
 * the deploy that reported the problem reported it as "CI cancelled" — the marker itself
 * was never named. This names it, in under a second, before anything else runs.
 *
 * A marker is only a marker at the START of a line: `=======` mid-sentence is a rule in a
 * Markdown table, and `>>>` appears in prose about shell redirection.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const START = '<<<<<<< ';
const END = '>>>>>>> ';
const MIDDLE = '=======';

/** This file quotes the markers it looks for, so it cannot check itself. */
const SELF = 'scripts/check-conflict-markers.mjs';

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean)
  .filter((f) => f !== SELF);

const hits = [];
for (const file of tracked) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree, or not readable as text
  }
  // Cheap pre-filter: almost every file fails this and is never split into lines.
  if (!text.includes(START) && !text.includes(END)) continue;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith(START) || line.startsWith(END) || line === MIDDLE) {
      hits.push(`${file}:${i + 1}  ${line.slice(0, 72)}`);
    }
  });
}

if (hits.length > 0) {
  console.error(`Conflict markers in ${new Set(hits.map((h) => h.split(':')[0])).size} file(s):`);
  for (const h of hits) console.error(`  ${h}`);
  console.error('\nA rebase was committed unresolved. Resolve the file, do not stage it as-is:');
  console.error('  `git add` CLEARS the unmerged state, so checking --diff-filter=U after');
  console.error('  adding always reports zero. Check BEFORE staging, or run this.');
  process.exit(1);
}

console.log(`Conflict-marker check OK — ${tracked.length} tracked file(s) clean.`);
