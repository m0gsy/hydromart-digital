#!/usr/bin/env node
/**
 * Turn a Firebase service-account JSON into the three env vars crm-service reads.
 *
 *   node scripts/fcm-setup.mjs ~/Downloads/hydromart-firebase-adminsdk-xxxxx.json
 *   node scripts/fcm-setup.mjs <file> --env .env.production   # write somewhere else
 *   node scripts/fcm-setup.mjs <file> --print                 # show, write nothing
 *
 * Why this exists rather than "paste three values into .env".
 *
 * FCM_PRIVATE_KEY is a PEM. A PEM is multi-line, and a .env file is not: a real newline
 * ends the variable, so the key silently truncates to its first line. The value has to
 * carry ESCAPED newlines (`\n`), which crm-config turns back into real ones before
 * `createSign` sees them. Get that wrong and nothing complains at boot — it surfaces later
 * as "every Android push fails", which is indistinguishable from the credentials being
 * absent, which is indistinguishable from nobody having any devices registered.
 *
 * So this reads the JSON Google gives you, escapes the key the one correct way, and — the
 * part that makes it worth a script — PROVES the key signs before writing anything. A
 * credential that cannot sign is caught here, on your laptop, in a second.
 *
 * What it does NOT do: create the Firebase project or the service account. Those need your
 * Google account. `--help` prints the console steps.
 *
 * Exit 0 = written (or printed); 1 = bad input, a key that cannot sign, or nothing to do.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSign, createPrivateKey } from 'node:crypto';

const VARS = ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'];

const HELP = `
Firebase console steps — these need your Google account, so no script can do them.

  1. https://console.firebase.google.com -> Add project (or open the existing one).
     Use ONE project for the app; the package name below has to live in it.

  2. Project settings -> General -> Your apps -> Add app -> Android.
     Register BOTH package names, in the SAME project — one google-services.json holds
     several apps in its \`client\` array, so you download it once, after adding both:

       id.hydromart.app     the customer binary (the gradle default)
       id.hydromart.ops     the staff binary   (-PhydromartAppId=id.hydromart.ops)

     Both are read out of mobile/android/app/build.gradle, not guessed. SHA-1/SHA-256
     fingerprints are optional here: they are for Google Sign-In and App Links, and
     Hydromart's App Links certificates are already handled separately.

     Then download \`google-services.json\`.

  3. This one is ALREADY WIRED, and it is NOT committed. Check before you touch it:

       gh secret list | grep GOOGLE_SERVICES_JSON_BASE64

     \`mobile.yml\` decodes that secret into mobile/android/app/google-services.json at
     build time and refuses the build when it is empty. The file is gitignored on purpose
     (mobile/.gitignore:3) — it names the Firebase project.

     Only if the secret is missing:
       base64 -w0 google-services.json      # then paste as that repo secret

     For a LOCAL release build, drop the file at mobile/android/app/google-services.json
     by hand; gradle skips the plugin without it and the APK ships with dead push.

  4. Project settings -> Service accounts -> Generate new private key.
     That downloads a JSON. Do NOT commit it anywhere.

  5. node scripts/fcm-setup.mjs <that-json>
     Then recreate crm so it picks the values up:
       bash scripts/deploy.sh env-set        (or your usual deploy)

  6. The deploy's own android-push probe will go green. Until then it stays red on
     purpose — that is CMP-05. If it is ALREADY green on your server, the credentials
     were set there before this probe existed and step 4-5 were never needed: the probe
     is what tells you which of the two it is, which is the whole point of adding it.

Note on rotation: the service-account key is a credential like any other. Generating a new
one in step 4 and re-running step 5 is the whole rotation; delete the old key in the console
afterwards.
`;

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(HELP.trim());
  process.exit(args.length === 0 ? 1 : 0);
}

const source = args.find((a) => !a.startsWith('--'));
const print = args.includes('--print');
const envIdx = args.indexOf('--env');
const envFile = envIdx === -1 ? '.env' : args[envIdx + 1];

if (!source || !existsSync(source)) {
  console.error(`No such file: ${source ?? '(none given)'}`);
  console.error('Pass the service-account JSON Firebase downloaded. --help for the steps.');
  process.exit(1);
}

let account;
try {
  account = JSON.parse(readFileSync(source, 'utf8'));
} catch (error) {
  console.error(`${source} is not valid JSON: ${error.message}`);
  process.exit(1);
}

// The shape Google hands out. Naming the missing field beats "invalid file".
for (const field of ['project_id', 'client_email', 'private_key']) {
  if (typeof account[field] !== 'string' || account[field].trim() === '') {
    console.error(`${source} has no "${field}".`);
    console.error(
      'That is the Service accounts -> "Generate new private key" download, not the\n' +
        'google-services.json from the Android app step. They are different files.',
    );
    process.exit(1);
  }
}

// The assertion that makes this worth running: a key that cannot sign is not a credential.
// crm-service would accept it at boot and fail on every single push.
try {
  const key = createPrivateKey(account.private_key);
  const signer = createSign('RSA-SHA256');
  signer.update('hydromart-fcm-setup');
  const signature = signer.sign(key);
  if (signature.length === 0) throw new Error('produced an empty signature');
} catch (error) {
  console.error(`The private key in ${source} cannot sign: ${error.message}`);
  console.error('Re-download it from Service accounts -> Generate new private key.');
  process.exit(1);
}

const values = {
  FCM_PROJECT_ID: account.project_id.trim(),
  FCM_CLIENT_EMAIL: account.client_email.trim(),
  // The one line this file exists for. Real newlines end a .env variable; escaped ones
  // survive it, and crm-config's `.replace(/\\n/g, '\n')` puts them back.
  FCM_PRIVATE_KEY: account.private_key.trim().replace(/\r?\n/g, '\\n'),
};

if (print) {
  for (const name of VARS) console.log(`${name}=${values[name]}`);
  process.exit(0);
}

const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
let out = existing;
const added = [];
const replaced = [];

for (const name of VARS) {
  const line = `${name}=${values[name]}`;
  // Only a real assignment at the start of a line — a commented example must not be
  // mistaken for the setting, and must not be uncommented by accident either.
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(out)) {
    out = out.replace(pattern, line);
    replaced.push(name);
  } else {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
    out += `${line}\n`;
    added.push(name);
  }
}

writeFileSync(envFile, out);

console.log(`Wrote ${envFile}:`);
for (const name of VARS) {
  const shown = name === 'FCM_PRIVATE_KEY' ? '<private key, escaped>' : values[name];
  console.log(`  ${name} = ${shown}  ${replaced.includes(name) ? '(replaced)' : '(added)'}`);
}
console.log('');
console.log('The key was verified to sign before this was written.');
console.log('Next: recreate crm so it reads them, then the deploy android-push probe goes green.');
if (added.length > 0 && envFile === '.env') {
  console.log('Reminder: .env is gitignored. Keep it that way — this is a live credential.');
}
