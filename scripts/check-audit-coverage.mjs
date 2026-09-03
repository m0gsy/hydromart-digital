#!/usr/bin/env node
/**
 * Every privileged write must be able to say who made it.
 *
 *   node scripts/check-audit-coverage.mjs
 *
 * CA-2-67. The audit trail and its cross-service ingest endpoint had existed since H-29,
 * and admin-service — which owns the API keys that authenticate partner traffic, the
 * feature flags, the webhook endpoints and the security policy — had no audit client of
 * any kind. Neither did the RBAC matrix or any staff role change in auth-service. Who
 * granted themselves a capability was answerable only from a container log that rotates.
 *
 * Interception is per controller rather than global, so the honest failure mode is a new
 * controller nobody remembers to attach it to. That is what this gate is for: a mutating
 * route in a covered service is either intercepted, or listed below with a reason someone
 * wrote down. It is not a lint rule about decorators — it is the coverage itself.
 *
 * The exemption list is checked in both directions. A stale entry — an exempted route that
 * no longer exists — fails too, because a list that only ever grows stops being read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Services whose controllers this gate polices. */
const COVERED = ['admin-service', 'auth-service'];

const INTERCEPTOR = 'AuditMutationsInterceptor';

/**
 * Routes deliberately outside the trail, each with the reason.
 *
 * `service:file:method` — the decorated method name, not the HTTP path, because the path
 * moves and the method is what carries the decorator.
 */
const EXEMPT = new Map([
  /*
   * Two firehoses. Both are machine-driven and both write one row per tick or per partner
   * event, so intercepting them would bury every decision a person made — which is the
   * same as not having a trail.
   */
  ['admin-service:sweep.controller.ts:record', 'sweep heartbeat, one row per tick per job'],
  [
    'admin-service:webhook-delivery.controller.ts:publish',
    'partner event ingest — the highest-volume write in the service',
  ],
  ['admin-service:webhook-delivery.controller.ts:process', 'delivery worker tick'],
  [
    'admin-service:webhook-delivery.controller.ts:replay',
    'replays a delivery already recorded in the delivery log, which keeps its own history',
  ],

  /*
   * auth-service writes these itself, and better than an interceptor could: the phone
   * routes mask the number before it reaches the table (K1.4), and the login and OTP
   * actions carry the IP and user-agent that a hijack investigation needs. Intercepting
   * them would double every row.
   */
  ['auth-service:auth.controller.ts:register', 'writes auth.register.requested itself'],
  ['auth-service:auth.controller.ts:verifyOtp', 'writes auth.otp.verified / auth.otp.failed'],
  ['auth-service:auth.controller.ts:resendOtp', 'writes auth.otp.resent'],
  ['auth-service:auth.controller.ts:login', 'writes auth.login.* with IP and user-agent'],
  ['auth-service:auth.controller.ts:refresh', 'writes auth.token.refreshed / reuse_detected'],
  [
    'auth-service:account.controller.ts:requestPhoneChange',
    'writes auth.phone.change_requested itself, with the number masked (K1.4)',
  ],
  [
    'auth-service:account.controller.ts:confirmPhoneChange',
    'writes auth.phone.changed itself, with the number masked (K1.4)',
  ],
  ['auth-service:account.controller.ts:revokeSession', 'a customer ending their own session'],
  ['auth-service:account.controller.ts:logout', 'writes auth.logout itself'],
  ['auth-service:account.controller.ts:logoutAll', 'writes auth.logout_all itself'],
  ['auth-service:audit.controller.ts:ingest', "the trail's own ingest — it would record itself"],

  /*
   * A customer acting on their own account is not a privileged decision, and this trail is
   * read by staff. Consent and erasure DO leave a record — in the PDP consent ledger, which
   * also stores the legal basis, the version of the notice, and the retention clock that
   * an audit row could not carry.
   */
  ['auth-service:account.controller.ts:updateProfile', 'a customer editing their own profile'],
  ['auth-service:avatar.controller.ts:upload', 'a customer changing their own photo'],
  ['auth-service:consent.controller.ts:set', 'recorded in the PDP consent ledger with its legal basis'],
  ['auth-service:data-subject.controller.ts:create', 'recorded in the PDP request ledger'],
  ['auth-service:data-subject.controller.ts:approve', 'the PDP ledger records the decider and the basis'],
  ['auth-service:data-subject.controller.ts:reject', 'the PDP ledger records the decider and the basis'],

  /*
   * Internal-key routes. The actor is another service's process, so `actorId` would be null
   * on every row; the human who caused it is recorded where they acted — hr-service records
   * the staff change, and the purge is a timer.
   */
  ['auth-service:internal.controller.ts:provisionStaff', 'hr-service records the human actor'],
  ['auth-service:internal.controller.ts:provisionManagedStaff', 'hr-service records the human actor'],
  ['auth-service:internal.controller.ts:setStaffActive', 'hr-service records the human actor'],
  ['auth-service:internal.controller.ts:updateStaffProfile', 'hr-service records the human actor'],
  ['auth-service:internal.controller.ts:assignStaffRole', 'hr-service records the human actor'],
  ['auth-service:internal.controller.ts:preRegisterCustomer', 'order-service walk-in capture'],
  ['auth-service:internal.controller.ts:lookupByIds', 'a POST that reads — a batch lookup, not a write'],
  ['auth-service:internal.controller.ts:purgeAuditLogs', 'timer-driven retention purge'],
]);

function controllerFiles(service) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.controller.ts')) out.push(p);
    }
  };
  walk(join(ROOT, 'services', service, 'src'));
  return out;
}

/**
 * Mutating handlers in one controller file, and whether each is intercepted.
 *
 * Deliberately a line scan rather than a parser: the decorators sit immediately above the
 * method, and a class-level `@UseInterceptors` above `@Controller` covers every method in
 * the file. That is the whole grammar this needs to read.
 */
function handlers(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const classLevel = lines.some(
    (l, i) =>
      l.includes(`@UseInterceptors(${INTERCEPTOR})`) &&
      lines.slice(i, i + 4).some((n) => n.startsWith('@Controller')),
  );
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*@(Post|Put|Patch|Delete)\(/.test(lines[i])) continue;
    // The handler name is the first `name(` after the decorator block.
    let name = null;
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j += 1) {
      const m = lines[j].match(/^\s+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
      if (m && !/^\s*@/.test(lines[j])) {
        name = m[1];
        break;
      }
    }
    if (!name) continue;
    // Method-level decorators sit in the block just above the HTTP verb; scan back to the
    // previous blank line or closing brace.
    let intercepted = classLevel;
    for (let j = i; j >= 0 && j > i - 25; j -= 1) {
      if (lines[j].includes(`@UseInterceptors(${INTERCEPTOR})`)) intercepted = true;
      if (/^\s*}\s*$/.test(lines[j]) && j !== i) break;
    }
    found.push({ name, intercepted });
  }
  return found;
}

const problems = [];
const seen = new Set();

for (const service of COVERED) {
  for (const file of controllerFiles(service)) {
    const base = file.split(/[\\/]/).pop();
    for (const h of handlers(file)) {
      const key = `${service}:${base}:${h.name}`;
      seen.add(key);
      if (h.intercepted) {
        if (EXEMPT.has(key)) {
          problems.push(`${key} is both intercepted and exempted — drop the exemption`);
        }
        continue;
      }
      if (!EXEMPT.has(key)) {
        problems.push(
          `${key} changes state and reaches no audit trail. ` +
            `Add @UseInterceptors(${INTERCEPTOR}), or exempt it in ${'scripts/check-audit-coverage.mjs'} with a reason.`,
        );
      }
    }
  }
}

for (const key of EXEMPT.keys()) {
  if (!seen.has(key)) {
    problems.push(`${key} is exempted but no longer exists — remove the stale entry`);
  }
}

// A gate that passes because it found nothing to look at is not a gate. The two services
// between them own well over twenty mutating routes; a scan that returns a handful means
// the file walk or the line grammar broke, not that the routes went away.
if (seen.size < 20) {
  problems.push(`only ${seen.size} mutating routes found across ${COVERED.join(', ')} — the scan is broken, not the code`);
}

if (problems.length) {
  console.error('Audit-trail coverage (CA-2-67):\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(`Audit-trail coverage OK — ${seen.size} mutating routes, ${EXEMPT.size} exempted.`);
