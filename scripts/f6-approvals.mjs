// F6 item 5: every approval DECISION point is guarded by the right capability, and
// the pairs that must stay apart stay apart.
//
//   node scripts/f6-approvals.mjs
//
// This checks the GUARD on each decision route, not the business outcome — the
// outcome is already covered by each service's own e2e suite. What no suite covers
// is the cross-service question F6 asks: given the 13 roles, can anyone reach a
// decision they should not, and can whoever RAISES a request also APPROVE it?
//
// Every probe uses a non-existent id on purpose. A guard runs before the handler, so
// 403 means refused and anything else (404 included) means the role got through —
// which is exactly the distinction being tested, without mutating any data.
//
// Exit code is the number of failed checks.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
import crypto from 'node:crypto';
import { fetchThrottled } from './lib/http.mjs';

import { CAPABILITIES } from '@hydromart/access';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(role, depotId = null) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: crypto.randomUUID(), role, phone: '+620000000000', depotId, iat: now, exp: now + 900 })}`;
  return `${data}.${crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url')}`;
}

// Depot-locked roles need a depot on the token or DepotScopeGuard rejects them before
// the capability guard is even reached — which would read as a false "refused".
const LOCKED = new Set(['STAFF_DEPOT', 'KEPALA_DEPOT']);
const NIL = '00000000-0000-4000-8000-000000000001';

async function probe(method, path, role) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokenFor(role, LOCKED.has(role) ? NIL : null)}`,
    },
    body: method === 'GET' ? undefined : '{}',
  });
  return res.status;
}

let failed = 0;
let passed = 0;
let skipped = 0;
/** Services the gateway could not reach at all — every row against them proves nothing. */
const unreachable = new Set();
function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * A row whose service is not running is not a pass and not a failure — it is a question
 * nobody asked. It was reported as FAIL, which turned "admin-service is not in the test
 * stack" into eleven role-guard failures and buried the one row that WAS a real finding.
 *
 * Counted, named and printed. Never silent: a gate that quietly drops rows is how a
 * coverage hole reads as a green tick.
 */
function skip(label, why) {
  skipped += 1;
  unreachable.add(why);
  console.log(`SKIP ${label} — ${why}`);
}

/** The gateway answers 502/503/504 for an upstream it cannot reach. */
const isUpstreamDown = (status) => status === 502 || status === 503 || status === 504 || status === 500;
const serviceOf = (path) => (path.match(/^\/([a-z-]+)\//) ?? [, 'gateway'])[1];

const ALL_ROLES = [
  'CUSTOMER', 'STAFF_DEPOT', 'KEPALA_DEPOT', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
  'MANAGER', 'DIREKTUR', 'FRANCHISE_OWNER', 'HEAD_OFFICE', 'FINANCE', 'MARKETING',
  'HR', 'SUPER_ADMIN',
];

/**
 * The 14 decision points, each named by the CAPABILITY that guards it. The allowed
 * roles are read out of @hydromart/access at run time rather than copied here —
 * a hand-kept second list is the drift this whole rebuild exists to remove, and it
 * would quietly go stale the first time somebody widened a capability.
 *
 * So this asserts the guards ENFORCE the matrix for all 13 roles. Whether the matrix
 * itself is right is a separate question, answered in the /hq/access console.
 */
const DECISIONS = [
  { label: 'depot approval queue (opname/deposit/COD/gallon)', cap: 'approvals', method: 'PATCH', path: `/depots/api/v1/approvals/${NIL}/decide` },
  { label: 'price override approve', cap: 'priceOverrideDecide', method: 'POST', path: `/depots/api/v1/price-overrides/${NIL}/approve` },
  { label: 'price override reject', cap: 'priceOverrideDecide', method: 'POST', path: `/depots/api/v1/price-overrides/${NIL}/reject` },
  { label: 'voucher request approve', cap: 'voucherRequestDecide', method: 'POST', path: `/vouchers/api/v1/voucher-requests/${NIL}/approve` },
  { label: 'voucher request reject', cap: 'voucherRequestDecide', method: 'POST', path: `/vouchers/api/v1/voucher-requests/${NIL}/reject` },
  { label: 'franchise application approve', cap: 'franchiseApplications', method: 'POST', path: `/depots/api/v1/franchise-applications/${NIL}/approve` },
  { label: 'franchise application reject', cap: 'franchiseApplications', method: 'POST', path: `/depots/api/v1/franchise-applications/${NIL}/reject` },
  // Reading the queue is NOT deciding it: the split is deliberate (`refundQueueRead` in
  // @hydromart/access — head office watches the queue, finance moves the money). This row
  // named `refundQueue` against the READ route, so it demanded a 403 from the two roles
  // the design deliberately gives the read to, and reported the design as a bug twice.
  { label: 'refund queue (read)', cap: 'refundQueueRead', method: 'GET', path: '/payments/api/v1/payments/refunds/queue' },
  { label: 'leave stage 1 (manager)', cap: 'leaveApprove', method: 'PATCH', path: `/hr/api/v1/leave/${NIL}/manager-decision` },
  { label: 'leave stage 2 (HR)', cap: 'hrAdmin', method: 'PATCH', path: `/hr/api/v1/leave/${NIL}/hr-decision` },
  { label: 'courier expense approve', cap: 'expenseApprove', method: 'POST', path: `/payout/api/v1/expenses/${NIL}/approve` },
  { label: 'courier expense reject', cap: 'expenseApprove', method: 'POST', path: `/payout/api/v1/expenses/${NIL}/reject` },
  { label: 'fraud flag block', cap: 'fraudReview', method: 'POST', path: `/admin/api/v1/fraud-flags/${NIL}/block` },
  { label: 'fraud flag clear', cap: 'fraudReview', method: 'POST', path: `/admin/api/v1/fraud-flags/${NIL}/clear` },
];

/**
 * Raise and approve must not land on the same role. These are the pairs the design
 * split ON PURPOSE — if a future matrix edit hands both to one role, whoever asks
 * for the money becomes whoever signs it off.
 */
const SEPARATION = [
  {
    label: 'refund: whoever raises must not decide',
    raise: { method: 'POST', path: '/payments/api/v1/payments/refunds', cap: 'refundIssue' },
    decide: { method: 'GET', path: '/payments/api/v1/payments/refunds/queue', cap: 'refundQueue' },
    // MANAGER may RAISE a refund but must never approve one.
    role: 'MANAGER',
  },
  {
    label: 'voucher: the depot that requests must not decide',
    raise: { method: 'POST', path: `/vouchers/api/v1/depots/${NIL}/voucher-requests`, cap: 'voucherWrite' },
    decide: { method: 'POST', path: `/vouchers/api/v1/voucher-requests/${NIL}/approve`, cap: 'voucherRequestDecide' },
    role: 'MANAGER',
  },
];

async function decisions() {
  console.log('— item 5: approval decision guards');
  for (const d of DECISIONS) {
    const allow = CAPABILITIES[d.cap];
    if (!allow) {
      check(`${d.label}: capability '${d.cap}' exists`, false, 'not in @hydromart/access');
      continue;
    }
    const deny = ALL_ROLES.filter((r) => !allow.includes(r));
    // One probe first: an upstream that is not in this stack answers every role the same
    // way, and asking it thirteen times only multiplies the noise.
    const reachable = await probe(d.method, d.path, allow[0]);
    if (isUpstreamDown(reachable)) {
      skip(`${d.label} (all roles)`, `${serviceOf(d.path)} answered ${reachable} — not reachable from this stack`);
      continue;
    }
    for (const role of allow) {
      const status = await probe(d.method, d.path, role);
      check(`${d.label}: ${role} may decide`, status !== 403 && status !== 401, `got ${status}`);
    }
    for (const role of deny) {
      const status = await probe(d.method, d.path, role);
      check(`${d.label}: ${role} REFUSED`, status === 403, `got ${status}`);
    }
  }
}

async function separationOfDuties() {
  console.log('— item 5: separation of duties');
  for (const s of SEPARATION) {
    const canRaise = await probe(s.raise.method, s.raise.path, s.role);
    const canDecide = await probe(s.decide.method, s.decide.path, s.role);
    check(`${s.label}: ${s.role} CAN raise (${s.raise.cap})`, canRaise !== 403, `got ${canRaise}`);
    check(
      `${s.label}: ${s.role} CANNOT decide (${s.decide.cap})`,
      canDecide === 403,
      `got ${canDecide}`,
    );
  }
}

async function main() {
  await decisions();
  await separationOfDuties();
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  for (const why of unreachable) console.log(`  not asked: ${why}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
