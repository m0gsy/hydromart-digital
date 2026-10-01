#!/usr/bin/env node
// Dependency-vulnerability CI gate (T4).
//
// Fails CI when `npm audit --omit=dev` reports a high/critical advisory that is
// NOT in the reviewed allowlist below. Production deps only — dev/build tooling
// vulns don't ship. New unreviewed highs block the PR; that's the point.
//
// To accept a residual vuln: add its GHSA id here WITH a one-line rationale and
// an upgrade path. This list IS the triage record — keep it honest, prune it
// when a real fix lands. Plain node + `npm audit --json`, no extra dependency.
//
// Run: npm run audit:ci

import { execFileSync } from 'node:child_process';

// GHSA id -> why it's accepted (no fix without a breaking change; low real risk).
// Re-check every release; delete the entry the moment a non-breaking fix exists.
const ALLOWLIST = {
  // exceljs@4 pulls a vulnerable archiver/zip chain. This CVE is in v3/v5 with a
  // `buf` argument; exceljs passes none, and hr-service only GENERATES reports
  // from trusted HR-authored data (never parses attacker-supplied xlsx).
  // Moderate, so it does not block the gate anyway — kept as the triage record.
  'GHSA-w5hq-g745-h8pq': 'exceljs>uuid buffer-bounds — v3/v5 with buf arg; exceljs passes no buf',

  // brace-expansion (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895) and postcss
  // (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849,
  // GHSA-fxqj-rqcc-2cmp) were allowlisted here until 2026-08-05. Both are now
  // FIXED by patch-level `overrides` in the root package.json — 1.1.18 / 2.1.4
  // and ^8.5.23. Entries deleted rather than kept: an allowlist that outlives
  // its vuln stops being a triage record.

  // sharp@0.34.5 is next's OPTIONAL image-optimization engine. No
  // images.remotePatterns is configured, so only local/bundled assets are
  // optimized — no attacker-controlled image reaches libvips. hr-service's own
  // sharp is bumped to 0.35.3 (patched); this entry is next's copy only.
  'GHSA-f88m-g3jw-g9cj': 'sharp libvips CVEs — next optional image-opt, local assets only; hr-service on 0.35.3',

  // ── 2026-09-09 advisory wave ──────────────────────────────────────────────
  // These four appeared overnight from the registry, with no repo change: `main`
  // itself went red on a commit whose CI had been green hours earlier. The two
  // CRITICAL `next` ids in the same wave were NOT allowlisted — they are fixed,
  // by 15.5.21 -> 15.5.25 in apps/web (a patch bump), which also drops `next`
  // from critical to moderate. What is left here is what has no fix to take.
  //
  // adm-zip (GHSA-xcpc-8h2w-3j85, GHSA-vwc7-r8mq-g2x9, GHSA-7q85-xj36-vmfc) and js-yaml
  // (GHSA-pm4m-ph32-ghv5) lived here until 2026-10-01, both "no fix without a parent
  // bump" at the time. Both were wrong about that: onnxruntime-node 1.27.0 -> 1.30.0
  // (still inside hr-service's own `^1.20.0`) widens its adm-zip pin from ^0.5.16 to
  // ^0.6.0, which resolves to the fixed 0.6.1 — `npm update` inside the existing range
  // did it, no override needed. @nestjs/swagger's 11.4.7 (still inside every service's
  // own `^11.0.0`) carries js-yaml 5.3.0, past pm4m's <=5.2.1. Entries deleted rather
  // than kept: an allowlist that outlives its vuln stops being a triage record.

  // sharp libheif, the SECOND advisory on the path GHSA-f88m above already
  // documents: next's OPTIONAL image-optimization engine. No images.remotePatterns
  // is configured, so only local/bundled assets reach libvips/libheif; hr-service's
  // own sharp is on 0.35.3.
  'GHSA-rgj7-g3m4-5g8c': 'sharp libheif CVEs — next optional image-opt, local assets only',

  // postcss, all four: the ROOT postcss is 8.5.25 (patched, via the override that
  // has been here since 2026-08-05). The vulnerable copy is next/node_modules/postcss
  // @8.4.31 — next BUNDLES its own, so the override cannot reach it. Every one of
  // these needs attacker-controlled CSS: a `</style>` in stringify output, or a
  // sourceMappingURL comment. This copy processes the app's OWN stylesheets at BUILD
  // time in CI. No user CSS is compiled, at build time or at run time.
  'GHSA-qx2v-qp2m-jg93': 'postcss </style> XSS — next-bundled build-time copy, our own CSS only',
  'GHSA-6g55-p6wh-862q': 'postcss sourceMappingURL file read — next-bundled build-time copy, our own CSS only',
  'GHSA-fxqj-rqcc-2cmp': 'postcss sourceMappingURL (incomplete fix) — next-bundled build-time copy, our own CSS only',
  'GHSA-r28c-9q8g-f849': 'postcss source-map path traversal — next-bundled build-time copy, our own CSS only',

  // multer's four entries (GHSA-wc9g/qfvm/qvfw/535w) lived here until 2026-10-01 as
  // "no fix to take: @nestjs/platform-express pins multer 2.2.0". That was checked
  // against 11.1.28; 11.2.7 — still inside every service's own `^11.0.0`, a patch-level
  // ask, not the major bump the old note assumed — pins multer 2.4.0, past every one of
  // these ranges. `npm update` inside the existing range did it, no override needed.
};

function audit() {
  try {
    // audit exits non-zero when vulns exist; capture stdout regardless.
    // shell:true on Windows only — npm is npm.cmd there, and Node 25 rejects
    // spawning a .cmd without a shell. Args are static, so no injection risk
    // (the one thing the resulting DEP0190 warning cautions about). CI is Linux
    // (plain `npm`, no shell, no warning).
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
  } catch (e) {
    if (e.stdout) return e.stdout;
    throw e;
  }
}

const report = JSON.parse(audit());
const vulns = report.vulnerabilities || {};
const blockers = [];

for (const [name, v] of Object.entries(vulns)) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  const ids = [
    ...new Set(
      (v.via || [])
        .filter((x) => typeof x === 'object' && x.url)
        .map((x) => x.url.split('/').pop()),
    ),
  ];
  // Direct advisories on this package that aren't allowlisted. A package whose
  // vuln is purely inherited (no own advisory id) is gated via its parent, so
  // an empty id list here means "not the root" — don't double-count it.
  const unreviewed = ids.filter((id) => !ALLOWLIST[id]);
  if (ids.length && unreviewed.length) {
    blockers.push({ name, severity: v.severity, ids: unreviewed });
  }
}

const meta = report.metadata?.vulnerabilities || {};
console.log(
  `npm audit (prod): ${meta.critical || 0} critical, ${meta.high || 0} high, ` +
    `${meta.moderate || 0} moderate — ${Object.keys(ALLOWLIST).length} allowlisted`,
);

if (blockers.length) {
  console.error('\n✗ Unreviewed high/critical vulnerabilities block CI:\n');
  for (const b of blockers) {
    console.error(`  ${b.severity.toUpperCase()} ${b.name}: ${b.ids.join(', ')}`);
  }
  console.error(
    '\nFix the dependency, or (if truly unfixable + not reachable) add the GHSA' +
      ' id to ALLOWLIST in scripts/audit-gate.mjs with a rationale.\n',
  );
  process.exit(1);
}

console.log('✓ No unreviewed high/critical production vulnerabilities.');
