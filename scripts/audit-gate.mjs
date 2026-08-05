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

  // adm-zip via onnxruntime-node — the on-device ONNX face driver, which is NOT
  // the production driver (FACE_VERIFIER_DRIVER=neo; see neo-face.provider.ts).
  // onnxruntime/sharp are optionalDependencies loaded lazily only by the onnx
  // driver, so this ZIP-bomb CVE is unreachable in prod. Fix (adm-zip>=0.6.0)
  // needs a full `npm install` override — deferred to the next dep refresh.
  'GHSA-xcpc-8h2w-3j85': 'adm-zip 4GB-alloc — onnxruntime (inactive onnx driver), not prod path',

  // js-yaml via @nestjs/swagger: parses the service's OWN decorator metadata to
  // build the OpenAPI doc — never attacker-supplied YAML. Fix exists but is
  // gated behind @nestjs/swagger's pin; deferred to the next dep refresh.
  'GHSA-pm4m-ph32-ghv5': 'js-yaml flow-collection DoS — swagger doc-gen from own decorators, no user YAML',
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
