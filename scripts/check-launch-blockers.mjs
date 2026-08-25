#!/usr/bin/env node
// The five launch blockers nobody but the owner can close — measured, not asserted.
//
//   node scripts/check-launch-blockers.mjs                       # informational, exit 0
//   node scripts/check-launch-blockers.mjs --production          # exit 1 unless launch-safe
//   node scripts/check-launch-blockers.mjs --production .env.production.example
//
// L2.1 OTP channel · L2.2 storage-key rotation · L2.3 per-depot payment instructions
// L2.4 business tunables still at their coded default · L2.6 App Links host
//
// Why a gate at all, for work no code can do. Each of these five needs a credential or a
// business decision, so the plan filed them as "owner only" and moved on — and that is
// exactly the shape of every failure this repo has already paid for. All five FAIL OPEN:
//
//   L2.1  the console channel prints login codes into the container log and boots green.
//   L2.2  a leaked S3 key keeps working until somebody revokes it. Nothing expires it.
//   L2.3  a depot with no bank account shows the customer an empty payment screen; the
//         order is still placed, and the money simply never arrives.
//   L2.4  a commission of 0% pays a franchise owner exactly what a working system pays
//         them, minus HQ's cut, and reconciles perfectly.
//   L2.6  App Links verification failing means links open in the browser. No error — not in
//         the app, not in the build, not in Play (see scripts/check-assetlinks.mjs).
//
// So "the owner has to do it" is not a status. This turns each one into a value that is
// either present or absent, prints what is required beside what is set, and — when told it
// is looking at a production configuration — refuses.
//
// Two modes, and the mechanism is the repo's own: the ENV FILE is the configuration.
// scripts/lib/deploy-common.sh treats `.env.example` as the contract and the `.env` that
// only exists on the box as the configuration; storage-policy.sh and check-registry-pull.sh
// both read that same `.env`. This does too. `--production` is what says "the file I just
// read is what customers will meet", because nothing inside an env file can say that on its
// own — docker-compose.prod.yml sets `NODE_ENV: production` itself, as a literal, so the
// file being examined never carries the fact.
//
// UNKNOWN is not a pass. When the live database cannot be reached, three of these checks
// cannot be answered, and under `--production` that exits non-zero exactly like a failure.
// This is deliberate, and it is the lesson from `unselected_provider_keys` in
// deploy-common.sh: "an unset or unreadable condition means cannot tell, and this check must
// never turn that into all clear". A launch gate that goes quiet when its instrument breaks
// is the gate this repo has already written by accident, several times.
//
// Self-check: scripts/check-launch-blockers.test.sh — proves every class can go RED.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const PRODUCTION = argv.includes('--production');
const ENV_FILE = argv.find((a) => !a.startsWith('--')) ?? '.env';

// Same overrides as create-indexes.sh / verify-indexes.sh: docker exec as the trusted local
// user, no .env needed. The self-check points PG_CONTAINER at a name that does not exist, to
// prove UNKNOWN is not a pass.
const PG_CONTAINER = process.env.PG_CONTAINER ?? 'hydromart-postgres';
const PG_USER = process.env.PG_USER ?? 'hydromart';
// Both overridable so the self-check can neutralise one input at a time without editing the
// real ones. `SERVICES_ROOT` is how it proves the L2.4 key list cannot go stale unnoticed.
const RUNBOOK = process.env.ROTATION_RUNBOOK ?? 'docs/RUNBOOK_SECRET_ROTATION.md';
const SERVICES_ROOT = process.env.SERVICES_ROOT ?? 'services';

/* ------------------------------------------------------------------ plumbing */

/** KEY=VALUE only, exactly the lines scripts/load-env.sh accepts. Everything else ignored. */
function readEnvFile(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    // A quoted value is the same value. Trailing whitespace is not a credential.
    out.set(m[1], m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2'));
  }
  return out;
}

const env = readEnvFile(ENV_FILE);
const get = (key) => (env.get(key) ?? '').trim();

/** One statement against one service database. `null` when the database cannot answer. */
function psql(db, sql) {
  try {
    return execFileSync(
      'docker',
      ['exec', PG_CONTAINER, 'psql', '-tAX', '-U', PG_USER, '-d', `hydromart_${db}`, '-c', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return null;
  }
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/**
 * A value that LOOKS set but is the example. `dummy` is what the local .env carries for
 * every S3 bucket it does not really use; `1234567890` is what the seed writes as a bank
 * account. Both are worse than blank: blank shows the customer nothing, and a plausible
 * wrong account number shows them somewhere to send money that is not the depot.
 */
const PLACEHOLDER_WORDS =
  /^(dummy|changeme|change-me|example|placeholder|todo|tbd|xxx+|test|isi[- ]?ini|ganti)/i;

/** Digits that were typed by walking the keyboard: 000000, 1234567890, 987654321. */
function looksLikeExampleDigits(value) {
  const d = value.replace(/[\s.-]/g, '');
  if (!/^\d{6,}$/.test(d)) return false;
  const steps = new Set();
  for (let i = 1; i < d.length; i += 1) {
    steps.add((Number(d[i]) - Number(d[i - 1]) + 10) % 10);
  }
  // One repeated step across the whole number: 0 (all same), 1 (ascending), 9 (descending).
  return steps.size === 1 && [0, 1, 9].some((s) => steps.has(s));
}

const isPlaceholder = (value) =>
  value === '' || PLACEHOLDER_WORDS.test(value) || looksLikeExampleDigits(value);

/* ------------------------------------------------------------------ findings */

const results = [];

/**
 * verdict is one of:
 *   'SAFE'    — measured, and it would work.
 *   'BLOCKED' — measured, and it would ship broken.
 *   'UNKNOWN' — could not measure. Fails under --production; see the header.
 */
function report(id, title, verdict, lines) {
  results.push({ id, title, verdict, lines });
}

/** UNKNOWN outranks BLOCKED: a gate that cannot see is worse news than one that can. */
function worse(current, next) {
  if (current === 'UNKNOWN' || next === 'UNKNOWN') return 'UNKNOWN';
  if (current === 'BLOCKED' || next === 'BLOCKED') return 'BLOCKED';
  return 'SAFE';
}

/* ---------------------------------------------------------------------- L2.1 */
/*
 * The OTP channel. auth-service already refuses to boot on `console` under
 * NODE_ENV=production (env.validation.ts, H-26) and docker-compose.prod.yml interpolates
 * OTP_DELIVERY_CHANNEL with `:?`, so an unset value stops the stack rather than defaulting.
 * Both of those happen at boot, on the box, after the deploy has started. This asks the same
 * question from the repo, before.
 *
 * The channel list and the console escape hatch are READ from the schema rather than copied.
 * A gate carrying its own copy of an enum is a gate that keeps checking a value the code has
 * retired — which this repo has shipped once already.
 */
{
  const schemaPath = `${SERVICES_ROOT}/auth-service/src/config/env.validation.ts`;
  const schema = read(schemaPath);
  if (!schema) {
    report('L2.1', 'OTP delivery channel', 'UNKNOWN', [
      `cannot read ${schemaPath} — the valid channel list and the console-acknowledgement`,
      'string live there, and guessing either would make this check a decoration',
    ]);
  } else {
    const lines = [];
    const valid = [
      ...(schema.match(/OTP_DELIVERY_CHANNEL:[^;]*?\.valid\(([^)]*)\)/s)?.[1] ?? '').matchAll(
        /'([a-z]+)'/g,
      ),
    ].map((m) => m[1]);
    const consoleAck = schema.match(/CONSOLE_ACK\s*=\s*'([^']+)'/)?.[1] ?? null;
    const channel = get('OTP_DELIVERY_CHANNEL');

    // Which credentials each channel needs. Taken from the two `.when(...)` branches at the
    // bottom of that same schema. Kept as a table because those branch bodies are Joi and
    // parsing them would mean writing a parser — but a channel the schema accepts and this
    // table does not know is reported UNKNOWN below, so a new provider cannot ship unchecked.
    const CREDENTIALS = {
      sms: ['SMS_API_BASE_URL', 'SMS_API_TOKEN'],
      zenziva: ['ZENZIVA_USERKEY', 'ZENZIVA_PASSKEY'],
    };

    let verdict = 'BLOCKED';
    const real = valid.filter((c) => c !== 'console');
    lines.push(
      `required: OTP_DELIVERY_CHANNEL is one of ${real.join(' / ') || '(schema unreadable)'}, with its credentials set`,
    );
    lines.push(`set in ${ENV_FILE}: OTP_DELIVERY_CHANNEL=${channel || '(unset)'}`);

    if (valid.length === 0) {
      verdict = 'UNKNOWN';
      lines.push('could not read the valid channel list out of the schema — refusing to guess it');
    } else if (channel === '') {
      lines.push(
        'unset. docker-compose.prod.yml interpolates this with `:?`, so production would not',
        'start at all — but the blocker is simpler than that: no customer can register.',
      );
    } else if (!valid.includes(channel)) {
      lines.push(`"${channel}" is not a channel the schema accepts — auth-service will not boot`);
    } else if (channel === 'console') {
      lines.push(
        'console prints the login code into the container log. Anyone who can read logs can',
        'sign in as any customer, and no real customer can register at all.',
      );
    } else {
      const required = CREDENTIALS[channel] ?? [];
      if (required.length === 0) {
        verdict = 'UNKNOWN';
        lines.push(
          `channel "${channel}" is valid in the schema but this gate has no credential list for`,
          'it — add one here rather than let a new provider ship unchecked',
        );
      } else {
        for (const key of required) {
          const value = get(key);
          lines.push(
            `  ${key} = ${value === '' ? '(blank)' : `${value.slice(0, 4)}… (${value.length} chars)`}`,
          );
        }
        const missing = required.filter((k) => isPlaceholder(get(k)));
        // A credential pointing at a laptop is set, valid, and useless in production. The
        // local .env really does carry SMS_API_BASE_URL=http://host.docker.internal:4599.
        const stub = required
          .filter((k) => /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/.test(get(k)))
          .map((k) => `${k}=${get(k)}`);
        if (missing.length) {
          lines.push(
            `blank or example: ${missing.join(', ')} — the provider would reject every send`,
          );
        } else if (stub.length) {
          lines.push(
            `points at a local stub: ${stub.join(', ')} — fine on a laptop, dead in production`,
          );
        } else {
          verdict = 'SAFE';
        }
      }
    }

    // The escape hatch, checked on its own: a real channel plus the acknowledgement is not a
    // contradiction, but the acknowledgement re-enables the log channel under
    // NODE_ENV=production, and it is the one value here that is deliberately unpleasant to
    // type. It exists for the E2E stack and belongs nowhere else.
    if (consoleAck && get('OTP_CONSOLE_ACK') === consoleAck) {
      verdict = 'BLOCKED';
      lines.push(
        'OTP_CONSOLE_ACK is set to the acknowledgement string, which is the ONLY way to run',
        'the log-printing channel under NODE_ENV=production.',
      );
    }
    report('L2.1', 'OTP delivery channel', verdict, lines);
  }
}

/* ---------------------------------------------------------------------- L2.2 */
/*
 * The storage key that leaked. Code cannot see a key's age, and the provider does not tell
 * us: the only record that a rotation happened is the ledger a human writes at the bottom of
 * docs/RUNBOOK_SECRET_ROTATION.md. That table IS the instrument, so this reads it.
 *
 * Two independent halves, because either alone lies:
 *   the ledger row  — was it ever rotated, and was the OLD key revoked. A new key living
 *                     beside an old one is two keys, not one replaced (the runbook says so
 *                     itself, in the sentence under the table).
 *   the env file    — production must be on the s3 driver with credentials that are not the
 *                     `dummy` placeholders the local .env carries.
 */
{
  const doc = read(RUNBOOK);
  const lines = [
    `required: ${RUNBOOK} records a rotation date for the S3 key AND that the old key was revoked`,
  ];
  let verdict = 'BLOCKED';

  if (!doc) {
    verdict = 'UNKNOWN';
    lines.push(
      `${RUNBOOK} is missing — the rotation ledger is the only record that a key was replaced`,
    );
  } else {
    /*
     * The ledger row for the S3 key. Two things matter about how it is found.
     *
     * The runbook holds TWO tables that both have a row for the S3 key: the recommended
     * schedule near the top ("90 hari, dan sekarang") and the rotation record at the bottom
     * ("_(belum pernah — L2.2)_"). The first version of this took the first match and read
     * the SCHEDULE row — it reached the right verdict for the wrong reason, which is the
     * exact shape of the probe that read `order_outbox` for a year. So the table is
     * identified by its own header ("Terakhir dirotasi"), and only rows inside it count.
     *
     * The label is matched, not a row number: the table grows.
     */
    const docLines = doc.split('\n');
    const header = docLines.findIndex((l) => l.startsWith('|') && /dirotasi|rotated/i.test(l));
    let row = null;
    for (let i = header + 1; header >= 0 && i < docLines.length; i += 1) {
      if (!docLines[i].startsWith('|')) break; // end of that table
      if (/kunci s3|s3 key/i.test(docLines[i]) && !docLines[i].includes('---')) {
        row = docLines[i];
        break;
      }
    }
    if (!row) {
      verdict = 'UNKNOWN';
      lines.push(
        `no ledger row for the S3 key in ${RUNBOOK}. The row was there when this gate was`,
        'written; if the table was restructured, teach this check the new shape — a missing',
        'row must never read as "rotated".',
      );
    } else {
      const cells = row.split('|').map((c) => c.trim());
      const [, , rotated = '', , revoked = ''] = cells;
      const never = (v) => v === '' || /belum|never|n\/?a|^[—-]+$/i.test(v);
      lines.push(
        `ledger: rotated=${rotated || '(blank)'} · old key revoked=${revoked || '(blank)'}`,
      );
      if (never(rotated)) {
        lines.push('never rotated. The key that leaked in conversation is still a valid key.');
      } else if (never(revoked) || !/ya|yes|sudah|done|✓/i.test(revoked)) {
        lines.push(
          'rotated, but the ledger does not say the OLD key was revoked — so it still works,',
          'and the rotation duplicated the secret instead of replacing it',
        );
      } else {
        verdict = 'SAFE';
      }
    }
  }

  // The env-file half. Every service has its own S3 block (AUTH_/HR_/PRODUCT_/DELIVERY_), so
  // the keys are found by suffix rather than named one by one — a new bucket is checked the
  // day somebody adds it.
  const driver = get('STORAGE_DRIVER');
  const secrets = [...env.keys()].filter((k) => k.endsWith('STORAGE_S3_SECRET_ACCESS_KEY'));
  const placeheld = secrets.filter((k) => isPlaceholder(get(k)));
  if (secrets.length === 0) {
    lines.push(
      `${ENV_FILE} sets no *_STORAGE_S3_SECRET_ACCESS_KEY — proof-of-delivery photos, product`,
      'photos and face frames would have nowhere to go',
    );
    verdict = worse(verdict, 'BLOCKED');
  } else if (placeheld.length) {
    lines.push(`placeholder storage secrets in ${ENV_FILE}: ${placeheld.join(', ')}`);
    verdict = worse(verdict, 'BLOCKED');
  } else {
    lines.push(`${secrets.length} storage secret(s) in ${ENV_FILE}, none of them placeholders`);
  }
  if (driver && driver !== 's3') {
    lines.push(
      `STORAGE_DRIVER=${driver} — local disk. A container's disk is not where a customer's`,
      'proof of delivery should live; the next deploy replaces the container.',
    );
    verdict = worse(verdict, 'BLOCKED');
  }

  report('L2.2', 'S3 key rotation', verdict, lines);
}

/* ---------------------------------------------------------------------- L2.3 */
/*
 * Per-depot payment instructions. There is no payment gateway: the franchise model sends
 * money straight to each depot, which is why those four columns are on `depots` and why they
 * are all nullable — "All optional until an owner sets them", says the schema comment.
 *
 * The live database is the only truthful source here. Nothing in the repo can know whether a
 * real depot has a bank account, and the API cannot be asked either: `:id/payment-info`
 * requires a bearer token by design, and a public bulk directory of every depot's account is
 * not something to build for a check. So this goes to Postgres the way create-indexes.sh and
 * verify-indexes.sh do — docker exec as the trusted local user.
 */
{
  // Fixture depots are excluded by code prefix, and the exclusion is PRINTED: a filter that
  // quietly drops rows is how a check ends up reporting "all clear" about nothing.
  const FIXTURES = "code ~ '^(E2E|UAT|HIER|DEMO)-'";
  const lines = [
    'required: every real, active depot has a bank account (name + number + holder) AND a QRIS image',
    'excluded as fixtures: depot codes matching E2E- / UAT- / HIER- / DEMO-',
  ];
  const rows = psql(
    'depot',
    "select code || E'\\t' || coalesce(\"paymentBankName\",'') || E'\\t' || " +
      "coalesce(\"paymentBankAccountNumber\",'') || E'\\t' || coalesce(\"paymentBankAccountHolder\",'') " +
      "|| E'\\t' || coalesce(\"paymentQrisImageUrl\",'') from depots " +
      `where active and not (${FIXTURES}) order by code;`,
  );

  if (rows === null) {
    report('L2.3', 'Per-depot payment instructions', 'UNKNOWN', [
      ...lines,
      `cannot reach the depot database (docker exec ${PG_CONTAINER} psql -d hydromart_depot).`,
      'This is the one blocker no file in the repo can answer, so an unreachable database is',
      'not "nothing wrong" — it is "not measured".',
    ]);
  } else {
    const depots = rows
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [code, bankName, number, holder, qris] = line.split('\t');
        return { code, bankName, number, holder, qris };
      });

    const broken = [];
    for (const d of depots) {
      const bank = Boolean(d.bankName && d.number && d.holder);
      const fake = bank && looksLikeExampleDigits(d.number);
      if (!bank && !d.qris) {
        broken.push(`${d.code}: no payment destination at all — the payment screen is blank`);
      } else if (fake) {
        broken.push(`${d.code}: account "${d.number}" is example digits, not an account number`);
      } else if (!bank) {
        broken.push(
          `${d.code}: QRIS only, no bank account — a customer who cannot scan cannot pay`,
        );
      } else if (!d.qris) {
        broken.push(`${d.code}: bank transfer only, no QRIS image`);
      }
    }
    lines.push(`measured: ${depots.length} real active depot(s), ${broken.length} not payable`);
    for (const b of broken) lines.push(`  ${b}`);
    if (depots.length === 0) {
      // Zero real depots is not "all depots are fine". It means the question was not answered.
      lines.push(
        'no real active depots at all — either this is not the production database, or the',
        'network has no depot a customer could order from',
      );
    }
    report(
      'L2.3',
      'Per-depot payment instructions',
      broken.length === 0 && depots.length > 0 ? 'SAFE' : 'BLOCKED',
      lines,
    );
  }
}

/* ---------------------------------------------------------------------- L2.4 */
/*
 * Business tunables still at the number a developer typed. Every one of these has a coded
 * default AND a per-depot/global override store (`service_settings`), so the system runs
 * either way — which is the whole problem. Nobody is ever told that the referral bonus
 * paying out today is the placeholder from the commit that introduced referrals.
 *
 * "Still at its example value" is measured as: no GLOBAL row in that service's settings
 * store, i.e. nobody has ever agreed a value. A DEPOT row is not enough — it decides one
 * depot and leaves the rest of the network on the default.
 *
 * The list is deliberately SHORT. There are roughly sixty setting keys across eight services
 * and most are operational (shift length, ETA speeds, poll intervals) where the coded default
 * is a perfectly good answer. These are the ones where the default is a placeholder standing
 * in for a decision about money.
 *
 * Each row names the file that defines the default, and that file is READ: if the key is no
 * longer there, this reports UNKNOWN rather than checking a retired knob for ever.
 */
{
  const TUNABLES = [
    {
      db: 'payout',
      key: 'platformFeePct',
      what: "HQ's cut of a depot's sales, printed on the reconciliation statement",
      source: `${SERVICES_ROOT}/payout-service/src/config/setting-defs.ts`,
      note: 'envDefault is 0 on purpose — no rate has ever been agreed',
    },
    {
      db: 'delivery',
      key: 'slaMinutes',
      what: 'delivery SLA — it decides what counts as late everywhere lateness is reported',
      source: `${SERVICES_ROOT}/delivery-service/src/config/setting-defs.ts`,
    },
    {
      db: 'loyalty',
      key: 'earnRateRupiah',
      what: 'rupiah spent per loyalty point — the price of the whole rewards programme',
      source: `${SERVICES_ROOT}/loyalty-service/src/config/setting-defs.ts`,
    },
    {
      db: 'loyalty',
      key: 'goldThreshold',
      what: 'membership ladder rungs (SILVER/GOLD/PLATINUM points and their discounts)',
      // These six have no env key at all: their default IS the domain constant, which the
      // config getter reads directly. So the file to watch is the domain, not setting-defs.
      source: `${SERVICES_ROOT}/loyalty-service/src/domain/membership.ts`,
      sourceNeedle: 'TIER_BENEFITS',
    },
    {
      db: 'referral',
      key: 'referrerPoints',
      what: 'points paid to whoever brings a customer in — a real cost per signup',
      source: `${SERVICES_ROOT}/referral-service/src/config/setting-defs.ts`,
    },
    {
      db: 'depot',
      key: 'gallonDepositIdr',
      what: 'gallon deposit taken from, and refunded to, the customer',
      source: `${SERVICES_ROOT}/depot-service/src/config/setting-defs.ts`,
    },
  ];

  const lines = ['required: someone has decided each of these and stored it at scope GLOBAL'];
  let verdict = 'SAFE';

  for (const t of TUNABLES) {
    const src = read(t.source);
    const needle = t.sourceNeedle ?? `'${t.key}'`;
    if (!src || !src.includes(needle)) {
      verdict = worse(verdict, 'UNKNOWN');
      lines.push(
        `  ${t.key}: ${t.source} no longer defines it (looked for ${needle}).`,
        '    Either it was renamed and this list is stale, or it was retired and this row',
        '    should go. Both are worse than a missing value: the gate is checking nothing.',
      );
      continue;
    }
    const stored = psql(
      t.db,
      `select coalesce(string_agg(scope || '=' || value, ', '), '') from service_settings where key = '${t.key}';`,
    );
    if (stored === null) {
      verdict = worse(verdict, 'UNKNOWN');
      lines.push(`  ${t.key}: cannot read hydromart_${t.db}.service_settings — not measured`);
      continue;
    }
    if (/(^|, )GLOBAL=/.test(stored)) {
      lines.push(`  ${t.key}: decided — ${stored}`);
    } else {
      verdict = worse(verdict, 'BLOCKED');
      lines.push(
        `  ${t.key}: running the coded default (${t.what})`,
        `    defined in ${t.source}${t.note ? ` — ${t.note}` : ''}`,
        `    stored overrides: ${stored || 'none'}`,
      );
    }
  }

  /*
   * The franchise commission, which is not a setting at all. `commission_schemes` holds one
   * effective-dated percentage per depot, and payout.service.ts reads it as
   *   (await this.schemes.currentForDepot(depotId))?.pct ?? 0
   * so a WARALABA depot with no row accrues a 0% commission: the ledger balances, the
   * statement prints, and HQ's cut of every order through that depot is silently zero. Two
   * databases, so two queries and a join here rather than in SQL.
   */
  const franchise = psql(
    'depot',
    "select coalesce(string_agg(id || E'\\t' || code, E'\\n'), '') from depots " +
      "where active and \"ownershipType\" = 'WARALABA' and not (code ~ '^(E2E|UAT|HIER|DEMO)-');",
  );
  const schemed = psql(
    'payout',
    "select coalesce(string_agg(distinct \"depotId\"::text, ','), '') from commission_schemes;",
  );
  if (franchise === null || schemed === null) {
    verdict = worse(verdict, 'UNKNOWN');
    lines.push(
      '  franchise commission: cannot reach hydromart_depot / hydromart_payout — not measured',
    );
  } else {
    const withScheme = new Set(schemed.split(',').filter(Boolean));
    const uncovered = franchise
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'))
      .filter(([id]) => !withScheme.has(id))
      .map(([, code]) => code);
    if (uncovered.length === 0) {
      lines.push('  franchise commission: every real active WARALABA depot has a scheme');
    } else {
      verdict = worse(verdict, 'BLOCKED');
      lines.push(
        `  franchise commission: ${uncovered.length} real active WARALABA depot(s) have NO`,
        `    commission_schemes row — ${uncovered.join(', ')}`,
        '    payout.service.ts falls back to `?? 0`, so HQ takes 0% and nothing reports it',
      );
    }
  }

  report('L2.4', 'Business tunables still at their coded default', verdict, lines);
}

/* ---------------------------------------------------------------------- L2.6 */
/*
 * App Links. The certificate half is already a gate — scripts/check-assetlinks.mjs, written
 * after the ops entry shipped twice with the wrong keys — so it is RUN here rather than
 * reimplemented. What that gate cannot check is the half only the owner can supply: the HOST.
 * The APK claims one domain (`hydromartWebHost` in mobile/android/app/build.gradle, fed by
 * the MOBILE_WEB_HOST repo variable in mobile.yml) and the assetlinks.json has to be served
 * from exactly that domain, over https. Get it wrong and verification fails, which means
 * links open in the browser and nothing anywhere says so.
 */
{
  const lines = [];
  let verdict = 'SAFE';

  // 1. Certificates — delegate to the gate that already knows about upload keys.
  try {
    const out = execFileSync('node', ['scripts/check-assetlinks.mjs'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    lines.push(`certificates: OK — ${out.split('\n').pop()}`);
  } catch (error) {
    verdict = worse(verdict, 'BLOCKED');
    lines.push('certificates: check-assetlinks.mjs FAILED —');
    for (const l of `${error.stdout ?? ''}${error.stderr ?? ''}`.split('\n')) {
      if (l.trim()) lines.push(`  ${l.trim()}`);
    }
  }

  // 2. The claimed host, read out of the build itself.
  const gradle = read('mobile/android/app/build.gradle');
  const claimed = gradle?.match(
    /hydromartWebHost\s*=\s*project\.findProperty\([^)]*\)\s*\?:\s*'([^']+)'/,
  )?.[1];
  const domain = get('WEB_DOMAIN');
  // Reserved TLDs (RFC 2606 / 6761) can never resolve, so an App Link on one can never
  // verify. mobile.yml's debug jobs fall back to `hydromart.example` on purpose; a RELEASE
  // build reaching this state means MOBILE_WEB_HOST was never set.
  const RESERVED = /(^|\.)(example|invalid|test|localhost)$/;

  if (!claimed) {
    verdict = worse(verdict, 'UNKNOWN');
    lines.push(
      'cannot read hydromartWebHost out of mobile/android/app/build.gradle — the host the',
      'APK claims is unknown, and a host nobody can name is a host nobody can serve',
    );
  } else {
    lines.push(`claimed by the APK (build.gradle default): ${claimed}`);
    lines.push(`served from (${ENV_FILE} WEB_DOMAIN): ${domain || '(unset)'}`);
    if (domain === '') {
      verdict = worse(verdict, 'BLOCKED');
      lines.push(
        `WEB_DOMAIN is unset, so nothing here serves https://${claimed}/.well-known/assetlinks.json.`,
        'The file is in the repo and its certificates are right; unverified is still unverified.',
      );
    } else if (RESERVED.test(domain) || RESERVED.test(claimed)) {
      verdict = worse(verdict, 'BLOCKED');
      lines.push('a reserved-TLD host cannot resolve, so App Links can never verify against it');
    } else if (domain !== claimed) {
      verdict = worse(verdict, 'BLOCKED');
      lines.push(
        `the APK claims ${claimed} and the site is served from ${domain}. Android fetches`,
        `https://${claimed}/.well-known/assetlinks.json and nothing else.`,
        'Set the MOBILE_WEB_HOST repo variable (mobile.yml passes it as -PhydromartWebHost),',
        'or change WEB_DOMAIN.',
      );
    }
  }

  /*
   * 3. Only a fetch proves the file is actually served. Three rules:
   *
   *  - Production only. This needs the real internet, and a gate that reaches the network
   *    from a laptop is a gate that goes red on bad wifi and then gets ignored.
   *  - The CLAIMED host, not WEB_DOMAIN. Android fetches the host inside the APK and nothing
   *    else, so that is the only host whose answer means anything.
   *  - Only when the host chain above is intact. Fetching a host we have already reported as
   *    wrong turns a measured BLOCKED into an UNMEASURED UNKNOWN, which reads as a weaker
   *    finding than the one we already have.
   */
  if (PRODUCTION && verdict === 'SAFE' && claimed) {
    const url = `https://${claimed}/.well-known/assetlinks.json`;
    const local = read('apps/web/public/.well-known/assetlinks.json');
    try {
      // `connection: close` and an explicit deadline, both for the same reason: a kept-alive
      // socket outliving the script trips a libuv assertion on Windows and the gate exits
      // 127 — a crash that looks nothing like a verdict.
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { connection: 'close' },
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.text();
      if (!res.ok) {
        verdict = worse(verdict, 'BLOCKED');
        lines.push(
          `${url} answered ${res.status} — Android gets the same answer and gives up silently`,
        );
      } else if (local && JSON.stringify(JSON.parse(body)) !== JSON.stringify(JSON.parse(local))) {
        verdict = worse(verdict, 'BLOCKED');
        lines.push(
          `${url} is served but does NOT match the copy in this repo — the deployed web image`,
          'is behind, and the certificates it publishes are the old ones',
        );
      } else {
        lines.push(`${url} → ${res.status}, byte-equal to the repo copy`);
      }
    } catch (error) {
      verdict = worse(verdict, 'UNKNOWN');
      lines.push(`could not fetch ${url}: ${error.message}`);
    }
  }

  report('L2.6', 'App Links host + certificates', verdict, lines);
}

/* ------------------------------------------------------------------- verdict */

const ICON = { SAFE: 'ok      ', BLOCKED: 'BLOCKED ', UNKNOWN: 'UNKNOWN ' };
console.log(
  `launch blockers — env file: ${ENV_FILE}${existsSync(ENV_FILE) ? '' : ' (does not exist)'}, ` +
    `mode: ${PRODUCTION ? 'production (failing)' : 'informational'}\n`,
);
for (const r of results) {
  console.log(`${ICON[r.verdict]}${r.id}  ${r.title}`);
  for (const line of r.lines) console.log(`          ${line}`);
  console.log('');
}

const blocked = results.filter((r) => r.verdict === 'BLOCKED');
const unknown = results.filter((r) => r.verdict === 'UNKNOWN');
console.log(
  `${results.length} blocker(s) checked · ${results.length - blocked.length - unknown.length} launch-safe · ` +
    `${blocked.length} blocked · ${unknown.length} not measurable`,
);

// `process.exitCode`, never `process.exit()`: killing the process while the L2.6 fetch still
// holds a socket trips `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv on
// Windows and the gate exits 127. A launch gate that dies with a C assertion instead of a
// verdict is indistinguishable from a launch gate that passed.
if (!PRODUCTION) {
  console.log(
    '\nInformational run. Add --production to fail on everything above, which is what a\n' +
      'release check should do:  node scripts/check-launch-blockers.mjs --production .env',
  );
} else if (blocked.length || unknown.length) {
  console.error(
    `\nNot launch-safe: ${[...blocked, ...unknown].map((r) => r.id).join(', ')}.\n` +
      'Every one of these fails OPEN — the stack boots, the screens render, and the money or\n' +
      'the login is quietly wrong. None of them can be closed from the repository.\n',
  );
  process.exitCode = 1;
} else {
  console.log('\nEvery owner-only launch blocker is closed and measured.');
}
