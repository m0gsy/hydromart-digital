#!/usr/bin/env node
/**
 * A transport that goes dead when its credentials are blank must be probed by the deploy.
 *
 *   node scripts/check-notification-probes.mjs
 *
 * CMP-05. crm-service reads two sets of transport credentials, both defaulting to blank,
 * and both disabling their channel silently in the adapter when blank:
 *
 *   VAPID_*   browser push
 *   FCM_*     Android push
 *
 * The deploy probed the first and not the second — and the line that reported the first
 * ended with "Android FCM is unaffected", which is a claim about a channel nothing had
 * ever looked at. Measured on a running stack while writing this: VAPID_PUBLIC_KEY set,
 * all three FCM variables EMPTY. Android push had been dead, and the deploy said so was
 * fine, on every release.
 *
 * The rule is derived, not listed. A getter in crm-config.service.ts whose doc comment says
 * blank values DISABLE something is a getter describing a silent failure, and every env var
 * it reads has to appear in a deploy probe. Add a third transport tomorrow and this asks
 * for its probe without anybody remembering to update a list here.
 *
 * Exit 0 = every silently-disableable credential is probed on deploy.
 */
import { readFileSync } from 'node:fs';

const CONFIG = 'services/crm-service/src/config/crm-config.service.ts';
const DEPLOY = 'scripts/deploy.sh';

const config = readFileSync(CONFIG, 'utf8');
const deploy = readFileSync(DEPLOY, 'utf8');

/**
 * Each `/** ... *\/ get name() { ... }` pair. The doc says whether blank is fatal; the body
 * says which variables blank would be.
 */
const getters = [...config.matchAll(/\/\*\*([\s\S]*?)\*\/\s*get\s+(\w+)\(/g)].map((m) => {
  const start = m.index + m[0].length;
  const body = config.slice(start, config.indexOf('\n  }', start));
  return {
    name: m[2],
    doc: m[1],
    // Only reads that default to BLANK. A var with a real default (VAPID_SUBJECT) cannot
    // be the thing that is missing, so demanding a probe for it is noise — and a check that
    // reports things nobody needs to act on is a check people stop reading.
    vars: [...body.matchAll(/config\.get<string>\('([A-Z0-9_]+)',\s*''\s*\)/g)].map((v) => v[1]),
  };
});

if (getters.length === 0) {
  console.error(`No documented getters parsed out of ${CONFIG} — this check went blind.`);
  process.exit(1);
}

// "disable", "disables", "disabling" — the word the two existing docs both use for the
// failure mode this is about: the channel stops working and nothing says so.
/*
 * `no-deploy-probe:` opts a getter out, and the marker has to carry a reason. That is not a
 * loophole, it is the difference between two failure shapes: CUSTOMER_SERVICE_URL blank
 * also "disables" something, but it fails CLOSED with SegmentUnavailableError — loud, on
 * the request, to the caller. Nothing is hidden, so a deploy probe adds nothing. Writing
 * the reason down is the price of the exemption; a silent omission is not enough.
 */
const silent = getters.filter(
  (g) => /\bdisabl/i.test(g.doc) && !/no-deploy-probe:/i.test(g.doc) && g.vars.length > 0,
);

if (silent.length === 0) {
  console.error(
    `${CONFIG} declares no credential whose absence silently disables a transport.\n` +
      'That is either a real simplification or a doc that stopped saying so — either way this\n' +
      'check is now measuring nothing, which is the failure it exists to prevent.',
  );
  process.exit(1);
}

const missing = [];
for (const getter of silent) {
  for (const variable of getter.vars) {
    // The probe has to name the variable somewhere outside a comment: it reads it out of
    // the container, so the literal name is unavoidable.
    const probed = deploy
      .split('\n')
      .some((line) => !line.trim().startsWith('#') && line.includes(variable));
    if (!probed) missing.push({ getter: getter.name, variable });
  }
}

if (missing.length > 0) {
  console.error(`${DEPLOY} does not probe every credential whose absence kills a channel:\n`);
  for (const m of missing) {
    console.error(`  - ${m.variable}  (crm-config "${m.getter}" — blank disables that transport)`);
  }
  console.error(
    '\nA channel that dies when a variable is blank, on a deploy that never looks at it,\n' +
      'is a channel nobody finds out about until a customer says they were never told.',
  );
  process.exit(1);
}

const total = silent.reduce((n, g) => n + g.vars.length, 0);
console.log(
  `Notification probe check OK — ${total} credential(s) across ${silent.length} transport(s) ` +
    `are probed on deploy.`,
);
