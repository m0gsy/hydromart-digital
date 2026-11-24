#!/usr/bin/env node
/**
 * D3 staging: a production AI web release should have run on staging first. WARNS (never fails,
 * until the owner decides it should): when this change puts a hydromart-ai digest into
 * infra/aiweb/docker-compose.yml that infra/aiweb-staging/docker-compose.yml never pinned before
 * (on the base branch, or in any earlier version of that file).
 *
 *   node scripts/check-aiweb-promotion.mjs [base ref, default origin/main]
 *
 * Prints a GitHub `::warning::` line per digest. Exit 0 always; skipped, saying so, where the base
 * ref cannot be read (a shallow checkout).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'origin/main';
const PROD = 'infra/aiweb/docker-compose.yml';
const STAGING = 'infra/aiweb-staging/docker-compose.yml';
const digests = (text) => new Set([...text.matchAll(/ghcr\.io\/[^\s@]+@(sha256:[0-9a-f]{64})/g)].map((m) => m[1]));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export function unpromoted(prodNow, prodBase, stagingEver) {
  return [...prodNow].filter((d) => !prodBase.has(d) && !stagingEver.has(d));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const prodBase = digests(git('show', `${base}:${PROD}`));
    const prodNow = digests(readFileSync(PROD, 'utf8'));
    let revs = [];
    try {
      revs = git('log', '--format=%H', '-n', '50', base, '--', STAGING).split('\n').filter(Boolean);
    } catch {
      // no history of the staging file on the base yet
    }
    // Pins made by this very change do not count: a release must have been pinned BEFORE it.
    const stagingBase = new Set(revs.flatMap((rev) => [...digests(git('show', `${rev}:${STAGING}`))]));
    const missing = unpromoted(prodNow, prodBase, stagingBase);
    for (const d of missing) {
      console.log(`::warning file=${PROD}::production pins ${d.slice(0, 19)}, which staging never ran (${STAGING} on ${base}): bump staging first, try it, then promote`);
    }
    console.log(missing.length === 0 ? 'check-aiweb-promotion: every new production pin was pinned on staging first (or none changed)' : `check-aiweb-promotion: ${missing.length} production pin(s) never ran on staging (warning only)`);
  } catch (error) {
    console.log(`check-aiweb-promotion: skipped (${String(error.message).split('\n')[0]})`);
  }
}
