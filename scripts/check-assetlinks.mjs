#!/usr/bin/env node
// Refuse an assetlinks.json that would leave App Links unverified — silently.
//
//   node scripts/check-assetlinks.mjs
//
// This gate exists because the failure it catches has already happened twice, and neither
// time did anything anywhere report it. App Links fail OPEN: the app installs, links keep
// opening in the browser instead of the app, no error is raised in the app, in the build,
// or in Play. The only way to know is to look — and looking means reading Play Console,
// which no test can do.
//
// What went wrong, both times, in the `id.hydromart.ops` entry:
//
//   1. The UPLOAD key was listed. `20ee86a7` had identified it by extracting the
//      certificate from the AAB's own `META-INF/*.RSA` block — the AAB is signed with the
//      upload key by definition — and MOBILE_PLAY_STORE.md says in as many words that it
//      is not the fingerprint to use. It was added anyway. Play re-signs every AAB, so a
//      build that reaches a user through Play never carries this certificate; listing it
//      grants the claim on the domain to whoever holds the upload keystore, which is us
//      rather than Google, and buys nothing for any build a user can install.
//   2. Two of the three Play signing certificates were MISSING. Play holds a classical and
//      a post-quantum certificate for this app and may present either; verification checks
//      one of them and the entry listed neither. The customer entry has had all three from
//      the start, which is why only the ops binary was broken and why comparing the two
//      entries is the check that would have caught it.
//
// `20ee86a7`'s own commit message claims "A check asserts the upload key is absent and
// every entry is 32 uppercase hex pairs". It does not exist — that commit touched only the
// JSON. This is that check, written after the failure it predicted.
import { readFileSync } from 'node:fs';

const FILE = 'apps/web/public/.well-known/assetlinks.json';

/**
 * The upload keystore's certificate, measured from the AAB rather than taken on trust
 * (`20ee86a7`), and confirmed against Play Console's own "Upload key certificate" panel.
 * One keystore signs both binaries, so this single value disqualifies both entries.
 */
const UPLOAD_KEY_SHA256 =
  'FA:0A:B1:2A:0E:A5:4D:A3:D9:09:47:B8:9A:8C:72:20:36:D5:5E:A5:09:3C:88:A3:21:44:D8:C6:0B:48:FB:BB';

/** Both binaries must be claimed. An entry that is simply absent is the quietest failure of all. */
const REQUIRED_PACKAGES = ['id.hydromart.app', 'id.hydromart.ops'];

/** 32 uppercase hex pairs, colon-separated. One missing colon fails exactly like a wrong key. */
const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

const problems = [];
const raw = readFileSync(FILE, 'utf8');

let statements;
try {
  statements = JSON.parse(raw);
} catch (error) {
  console.error(`${FILE} is not valid JSON: ${error.message}`);
  process.exit(1);
}

const seenPackages = new Set();
for (const statement of statements) {
  const app = statement?.target ?? {};
  const pkg = app.package_name ?? '(unnamed)';
  seenPackages.add(pkg);

  if (!statement.relation?.includes('delegate_permission/common.handle_all_urls')) {
    problems.push(`${pkg}: missing the handle_all_urls relation`);
  }

  const prints = app.sha256_cert_fingerprints ?? [];
  if (prints.length === 0) problems.push(`${pkg}: no fingerprints at all`);

  for (const print of prints) {
    if (!FINGERPRINT.test(print)) {
      problems.push(`${pkg}: "${print}" is not 32 uppercase hex pairs`);
    }
    if (print === UPLOAD_KEY_SHA256) {
      problems.push(
        `${pkg}: lists the UPLOAD key — Play re-signs every AAB, so this is never the certificate a user's install carries`,
      );
    }
  }

  const duplicates = prints.filter((p, i) => prints.indexOf(p) !== i);
  for (const duplicate of new Set(duplicates)) {
    problems.push(`${pkg}: ${duplicate} is listed twice`);
  }
}

for (const required of REQUIRED_PACKAGES) {
  if (!seenPackages.has(required)) problems.push(`${required}: no statement claims this package`);
}

/**
 * Both binaries are signed by the same Play account under the same scheme, so they hold the
 * same NUMBER of certificates — a classical one, a post-quantum one, and the one Play prints
 * in its own Digital Asset Links snippet. The ops entry sat at one for a whole release while
 * the customer entry had three, and nothing said so. Counts, not values: the certificates
 * themselves differ per app, and only their absence is the bug.
 */
const counts = Object.fromEntries(
  statements.map((s) => [
    s.target?.package_name,
    (s.target?.sha256_cert_fingerprints ?? []).length,
  ]),
);
const distinct = new Set(REQUIRED_PACKAGES.map((p) => counts[p]).filter((n) => n !== undefined));
if (distinct.size > 1) {
  problems.push(
    `the two binaries list different numbers of certificates (${REQUIRED_PACKAGES.map((p) => `${p}=${counts[p]}`).join(', ')}) — one of them is missing some of its Play signing keys`,
  );
}

if (problems.length) {
  console.error(`${FILE}: App Links would not verify\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nFingerprints come from Play Console: Setup -> App integrity -> App signing key certificate.',
  );
  console.error('Use the App signing keys (all of them). Never the Upload key certificate.');
  process.exit(1);
}

console.log(
  `assetlinks: ${statements.length} statement(s), ${REQUIRED_PACKAGES.map((p) => `${p}=${counts[p]}`).join(' ')}, no upload key`,
);
