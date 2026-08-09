#!/usr/bin/env node
/**
 * F7: what the two binaries actually ask the phone for.
 *
 *   node scripts/audit-manifest.mjs                       # our manifest + every plugin's
 *   node scripts/audit-manifest.mjs <dir-or-file>       # what Gradle really produced
 *
 * A Play listing is rejected — or dragged into a declaration process that takes weeks —
 * over a permission nobody meant to ship. The dangerous ones do not appear in any file a
 * person reads: a plugin's own manifest is merged into the app's, and so is the manifest
 * of every AAR that plugin depends on. `READ_MEDIA_IMAGES` arriving that way triggers the
 * Photo & Video Permissions declaration; `ACCESS_BACKGROUND_LOCATION` needs a foreground
 * service, a written justification and a demo video. Neither is a thing to discover after
 * upload.
 *
 * So this refuses anything not on the list below, rather than warning about a denylist of
 * the ones known to be bad today. A new plugin that brings a new permission fails here,
 * and the fix is to write down why it is needed in docs/MOBILE_PLAY_STORE.md and add it —
 * which is exactly the sentence the Play form is going to ask for anyway.
 *
 * Run it against the merged manifest in CI (after `bundleRelease`, from
 * `app/build/intermediates/merged_manifests/release/`), where the AAR contributions are
 * finally visible. Run without arguments locally, where they are not.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every permission the two apps are allowed to request, and the sentence that justifies
 * it. Keep this in step with the table in docs/MOBILE_PLAY_STORE.md — the wording there
 * is what goes into Play Console.
 */
const ALLOWED = new Map([
  ['android.permission.INTERNET', 'Talks to the Hydromart API. Nothing works without it.'],
  [
    'android.permission.POST_NOTIFICATIONS',
    'Order status push (FCM). Runtime prompt, asked after the first order is placed.',
  ],
  [
    'android.permission.CAMERA',
    'Proof-of-delivery photos and HR face check-in, captured live through getUserMedia.',
  ],
  [
    'android.permission.ACCESS_COARSE_LOCATION',
    'Courier position while a delivery is open. Foreground only.',
  ],
  [
    'android.permission.ACCESS_FINE_LOCATION',
    'Courier position while a delivery is open. Foreground only.',
  ],
  ['android.permission.USE_BIOMETRIC', 'Unlocks the stored session (F3b). Never sent anywhere.'],
  [
    'android.permission.USE_FINGERPRINT',
    'Legacy form of USE_BIOMETRIC, contributed by androidx.biometric for API <= 28.',
  ],
  [
    'android.permission.ACCESS_NETWORK_STATE',
    'Contributed by Play Services / FCM to hold messages until the device is online.',
  ],
  [
    'android.permission.WAKE_LOCK',
    'Contributed by FCM so a delivered message can wake the device far enough to show.',
  ],
  [
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'Contributed by FCM so push still arrives after a restart.',
  ],
  [
    'com.google.android.c2dm.permission.RECEIVE',
    'Contributed by FCM. The permission that lets the app receive a push at all.',
  ],
  ['android.permission.VIBRATE', 'Contributed by FCM. Notification vibration, no separate prompt.'],
  [
    'android.permission.FOREGROUND_SERVICE',
    'Contributed by Play Services. Not used by any code in this app.',
  ],
]);

/**
 * The same list, for the permissions whose NAME contains the applicationId — so the exact
 * string differs between the two binaries and cannot be a map key.
 */
const ALLOWED_PATTERNS = [
  [
    /^[\w.]+\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$/,
    'Contributed by androidx.core. A signature-level permission the app grants only to ' +
      'itself, so a broadcast registered with RECEIVER_NOT_EXPORTED cannot be reached by ' +
      'another app. Never prompts, never appears in the Play listing.',
  ],
];

/** The sentence that justifies this permission, or null if nothing does. */
function justify(name) {
  return ALLOWED.get(name) ?? ALLOWED_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

const PERMISSION = /<uses-permission[^>]*android:name="([^"]+)"/g;

function permissionsIn(file) {
  const xml = readFileSync(file, 'utf8');
  return [...xml.matchAll(PERMISSION)].map((m) => m[1]);
}

/**
 * Accept a directory as well as a file, and find the manifest inside it.
 *
 * The caller is Gradle's intermediates tree, whose layout is AGP's business and not a
 * contract: 8.x puts the merged manifest under a directory named after the task that
 * produced it, older versions did not, and pinning the exact path here means a plugin
 * upgrade turns the permission gate off by making it fail to find its input. Searching
 * cannot go stale that way.
 */
function resolveManifest(path) {
  if (!existsSync(path)) return null;
  if (statSync(path).isFile()) return path;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const found = entry.isDirectory()
      ? resolveManifest(join(path, entry.name))
      : entry.name === 'AndroidManifest.xml'
        ? join(path, entry.name)
        : null;
    if (found) return found;
  }
  return null;
}

/** Our own manifest, plus every installed Capacitor plugin's. */
function sourceManifests() {
  const files = [join(ROOT, 'android/app/src/main/AndroidManifest.xml')];
  const modules = join(ROOT, 'node_modules');
  for (const scope of ['@capacitor', '@aparajita']) {
    const dir = join(modules, scope);
    if (!existsSync(dir)) continue;
    for (const pkg of readdirSync(dir)) {
      for (const candidate of [
        join(dir, pkg, 'android/src/main/AndroidManifest.xml'),
        join(dir, pkg, 'capacitor/src/main/AndroidManifest.xml'),
      ]) {
        if (existsSync(candidate)) files.push(candidate);
      }
    }
  }
  return files;
}

const argument = process.argv[2];
let files;
if (argument) {
  const merged = resolveManifest(resolve(argument));
  if (!merged) {
    console.error(`No AndroidManifest.xml at or under ${argument}`);
    process.exit(1);
  }
  files = [merged];
} else {
  files = sourceManifests();
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error(`No manifest at ${missing.join(', ')}`);
    process.exit(1);
  }
}

/** permission -> the manifests that ask for it. */
const found = new Map();
for (const file of files) {
  for (const permission of permissionsIn(file)) {
    const where = found.get(permission) ?? [];
    where.push(relative(ROOT, file));
    found.set(permission, where);
  }
}

const names = [...found.keys()].sort();
console.log(
  argument
    ? `Merged manifest: ${relative(ROOT, files[0])}`
    : `${files.length} source manifests (our app + every installed plugin)`,
);
for (const name of names) {
  const justification = justify(name);
  console.log(`  ${justification ? 'OK  ' : 'NEW '} ${name}`);
  if (justification) console.log(`         ${justification}`);
  else console.log(`         asked for by: ${found.get(name).join(', ')}`);
}

const unjustified = names.filter((n) => justify(n) === null);
if (unjustified.length) {
  console.error(
    `\n${unjustified.length} permission(s) with no justification. Write down why each is` +
      ` needed in docs/MOBILE_PLAY_STORE.md and add it to ALLOWED in this script — that` +
      ` sentence is what Play Console asks for.`,
  );
  process.exit(1);
}

console.log(`\n${names.length} permissions, all justified.`);
