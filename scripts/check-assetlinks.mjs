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

/**
 * K5.6 — what each of these six strings actually IS.
 *
 * The file held six 95-character hex strings and no record anywhere of which key each one
 * belonged to. That matters more than tidiness: the whole class of bug this gate exists
 * for is "the wrong certificate is in here", and you cannot spot a wrong certificate in a
 * list where every entry is anonymous. Two of the three ways to get it wrong have already
 * happened once each, and neither was visible from the file.
 *
 * All six are PLAY APP SIGNING certificates. Play holds three per app side by side — a
 * classical one, a post-quantum one, and the one it prints in its own Digital Asset Links
 * snippet — and verification may check any of them, which is why all three are listed and
 * why a count that differs between the two apps is a bug (see the count check below).
 *
 * The two kinds that must NEVER appear, and why each is worse than it looks:
 *
 *   upload key   Play re-signs every AAB, so no install a user can get carries it. Listing
 *                it hands the domain claim to whoever holds `upload.jks` — us, not Google
 *                — and buys nothing. Measured from the AAB and confirmed in Play Console
 *                (`20ee86a7`); asserted absent below.
 *   debug key    `~/.android/debug.keystore`, one per developer machine. Anything signed
 *                with it would be treated by Android as the real app for this domain, and
 *                a debug build's WebView has none of a release build's assumptions.
 *
 * Because a fingerprint carries no evidence of which key it came from, the rule here is
 * the registry itself: every value in the file must be named, and adding a seventh means
 * writing down what it is. That is the record the file could not hold — assetlinks.json is
 * JSON and JSON has no comments, which is exactly how six anonymous strings accumulated.
 */
const FINGERPRINT_REGISTRY = new Map([
  ['07:3A:F8:6A:38:2C:1C:25:2C:D3:17:B9:35:97:27:48:BB:BB:10:40:27:68:3C:F1:03:08:78:4B:2C:3A:DD:94', 'id.hydromart.app · Play App Signing'],
  ['9A:CC:7C:3F:1C:74:E7:69:E5:2C:4F:1F:CD:71:92:25:F7:AC:FB:33:18:B8:EE:D9:2D:F7:15:84:BB:FE:5B:E1', 'id.hydromart.app · Play App Signing'],
  ['48:71:38:C8:FA:E3:3B:58:32:98:B4:BB:BD:4A:5D:CE:FA:3A:81:23:26:84:69:F9:81:15:B2:EC:3B:26:31:FA', 'id.hydromart.app · Play App Signing'],
  ['A8:2A:BA:36:F4:20:9D:21:8A:DB:81:E4:D2:45:B1:E8:12:BA:3B:CD:99:80:08:06:2B:27:48:3A:4A:85:33:31', 'id.hydromart.ops · Play App Signing'],
  ['9B:51:65:96:0A:72:7B:89:55:E2:FB:F9:E2:52:A5:ED:91:0C:6E:34:CD:EF:50:B9:E5:A0:B9:45:A8:8F:35:20', 'id.hydromart.ops · Play App Signing'],
  ['4F:8D:E8:16:A6:51:EB:E7:B9:06:3A:5F:5D:38:35:46:35:20:B7:31:5B:3C:46:83:33:31:3D:D2:60:9E:38:28', 'id.hydromart.ops · Play App Signing'],
]);

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
      continue;
    }
    // K5.6: an unnamed fingerprint is the state this whole file was in. Whoever adds one
    // has to say what it is, which is the only moment anybody can still tell.
    const known = FINGERPRINT_REGISTRY.get(print);
    if (!known) {
      problems.push(
        `${pkg}: ${print} is not named in FINGERPRINT_REGISTRY — say which key it is (Play App Signing / upload / debug) before adding it`,
      );
    } else if (!known.startsWith(pkg)) {
      // Both apps' certificates live in one registry, so a value pasted under the wrong
      // package_name is caught here rather than by Android silently declining to verify.
      problems.push(`${pkg}: ${print} is registered as "${known}" — it belongs to the other binary`);
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
