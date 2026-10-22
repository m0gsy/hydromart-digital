// Live RBAC check for custom roles / built-in role settings / per-depot rules, against the running
// prod-like stack through the gateway. Every assertion that proves a REFUSAL is paired with a
// control that proves the same call succeeds when it should (a refusal that also happens for the
// wrong reason would otherwise pass).
//
//   node .uat/rbac/rbac-live.mjs            -> prints a table, exits 1 on any failure
//
// Tokens are minted like auth-service signs them (lib.mjs), so no SMS/OTP is involved.
import { execSync } from 'node:child_process';
import { api, mintToken, uniq } from '../lib.mjs';

const rows = [];
let failed = 0;
function check(name, ok, detail = '') {
  rows.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (db, q) =>
  execSync(`docker exec -i hydromart-postgres psql -U hydromart -d ${db} -At`, { input: q, encoding: 'utf8' }).trim();

const SA = mintToken('SUPER_ADMIN', { sub: crypto.randomUUID() });
const HO = mintToken('HEAD_OFFICE', { sub: crypto.randomUUID() });
const A = '7fe2f622-f01a-4177-bd0a-24cc599b47dd';
const B = 'b60f6af3-47db-4a39-9f0b-893b93144ecd';
const NAME = `Kasir ${uniq()}`;
const KEY = 'C_' + NAME.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const EMP = { position: 'Kasir', joinDate: '2026-10-22', employmentStatus: 'PROBATION', salaryType: 'MONTHLY', monthlyRate: 4500000 };

const status = async (method, path, opts) => (await api(method, path, { noRetry: false, ...opts })).status;
const ORDERS = (token, depotId) =>
  api('GET', `/orders/api/v1/orders/manage${depotId ? `?depotId=${depotId}` : ''}`, { token });

/** Other services pick a change up on their next poll (30 s) + the 15 s auth cache. */
async function until(fn, label, ms = 70000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(3000);
  }
  console.log(`      (gave up waiting for: ${label})`);
  return false;
}

async function main() {
  // ---- 1. creating, duplicates, who may -------------------------------------------------
  let r = await api('POST', '/auth/api/v1/access/roles', { token: HO, body: { name: NAME, scope: 'LOCKED' } });
  check('HEAD_OFFICE cannot create a role', r.status === 403, `status ${r.status}`);

  r = await api('POST', '/auth/api/v1/access/roles', { token: SA, body: { name: NAME, scope: 'LOCKED' } });
  check('SUPER_ADMIN creates a LOCKED role', r.status === 201 && r.body?.key === KEY, `status ${r.status} key ${r.body?.key}`);

  r = await api('POST', '/auth/api/v1/access/roles', { token: SA, body: { name: NAME.toUpperCase(), scope: 'GLOBAL' } });
  check('a duplicate name (any case) is a 409', r.status === 409, `status ${r.status}`);

  r = await api('POST', '/auth/api/v1/access/roles', { token: SA, body: { name: `Salinan ${uniq()}`, copyFrom: 'MANAGER' } });
  check('create-from MANAGER copies its reach (RESOLVED)', r.status === 201 && r.body?.scope === 'RESOLVED', `status ${r.status} scope ${r.body?.scope}`);
  const copyKey = r.body?.key;

  // ---- 2. forbidden capabilities --------------------------------------------------------
  for (const cap of ['staffAdmin', 'accessMatrixWrite', 'hrAdmin', 'platformAdmin']) {
    r = await api('PUT', `/auth/api/v1/access/matrix/${cap}`, { token: SA, body: { roles: ['SUPER_ADMIN', KEY] } });
    check(`a custom role cannot hold ${cap}`, r.status === 400, `status ${r.status}`);
  }

  // ---- 3. global grant + depot fence ----------------------------------------------------
  const m = await api('GET', '/auth/api/v1/access/matrix', { token: SA });
  const holders = m.body?.effective?.orderManageRead ?? [];
  r = await api('PUT', '/auth/api/v1/access/matrix/orderManageRead', { token: SA, body: { roles: [...holders, KEY] } });
  check('SUPER_ADMIN grants orderManageRead to the role', r.status === 204, `status ${r.status}`);

  const kasirA = mintToken(KEY, { sub: crypto.randomUUID(), depotId: A });
  const ok = await until(async () => (await ORDERS(kasirA, A)).status === 200, 'role visible in order-service');
  check('role holder reads its OWN depot (control)', ok);
  check('role holder is refused ANOTHER depot', (await ORDERS(kasirA, B)).status === 403);
  check('role holder without that capability is refused elsewhere', (await api('GET', '/depots/api/v1/depots/manage', { token: kasirA })).status === 403);
  check('an unknown role string never reaches the data', (await ORDERS(mintToken('WIZARD', { depotId: A }), A)).status === 403);

  // ---- 4. per-depot rules -----------------------------------------------------------------
  r = await api('PUT', `/auth/api/v1/access/matrix/orderManageRead/depots/${A}/HEAD_OFFICE`, { token: SA, body: { effect: 'DENY' } });
  check('a rule for a network-wide role is refused', r.status === 400, `status ${r.status}`);
  r = await api('PUT', `/auth/api/v1/access/matrix/staffAdmin/depots/${A}/MANAGER`, { token: SA, body: { effect: 'GRANT' } });
  check('GRANT of a forbidden capability per depot is refused', r.status === 400, `status ${r.status}`);

  r = await api('PUT', `/auth/api/v1/access/matrix/orderManageRead/depots/${A}/${KEY}`, { token: SA, body: { effect: 'DENY' } });
  check('SUPER_ADMIN sets DENY at depot A', r.status === 204, `status ${r.status}`);
  const denied = await until(async () => (await ORDERS(kasirA, A)).status === 403, 'DENY enforced');
  check('DENY beats the global grant at depot A', denied);

  r = await api('DELETE', `/auth/api/v1/access/matrix/orderManageRead/depots/${A}/${KEY}`, { token: SA });
  check('the rule is removed', r.status === 204, `status ${r.status}`);
  check('access returns after removing the DENY', await until(async () => (await ORDERS(kasirA, A)).status === 200, 'DENY lifted'));

  // ---- 5. an account holding the role -------------------------------------------------------
  const phone = '+62812' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  r = await api('POST', '/auth/api/v1/auth/staff/invite', { token: HO, body: { phone, role: KEY, fullName: 'Kasir Uji', depotId: A, ...EMP } });
  check('HEAD_OFFICE cannot assign a custom role', r.status === 403, `status ${r.status}`);
  r = await api('POST', '/auth/api/v1/auth/staff/invite', { token: SA, body: { phone, role: KEY, fullName: 'Kasir Uji', depotId: A, ...EMP } });
  check('SUPER_ADMIN assigns it (account + employee created)', r.status === 201 || r.status === 200, `status ${r.status} ${JSON.stringify(r.body ?? '').slice(0, 120)}`);
  const acct = r.body?.id;

  if (acct) {
    const me = await api('GET', '/auth/api/v1/auth/me', { token: mintToken(KEY, { sub: acct, depotId: A }) });
    check('/auth/me carries its capabilities and roleScope', me.status === 200 && me.body?.roleScope === 'LOCKED' && me.body?.capabilities?.includes('orderManageRead'), `status ${me.status} scope ${me.body?.roleScope}`);
    r = await api('DELETE', `/auth/api/v1/access/roles/${KEY}`, { token: SA });
    check('archiving is refused while an account holds the role', r.status === 409, `status ${r.status}`);
  }

  // ---- 6. built-in role: scope, disable ---------------------------------------------------
  r = await api('PUT', '/auth/api/v1/access/builtin/SUPER_ADMIN/disabled', { token: SA, body: { disabled: true } });
  check('SUPER_ADMIN can never be switched off', r.status === 400, `status ${r.status}`);
  r = await api('PUT', '/auth/api/v1/access/builtin/FRANCHISE_OWNER', { token: SA, body: { scope: 'LOCKED' } });
  check('FRANCHISE_OWNER reach is fixed', r.status === 400, `status ${r.status}`);

  const fin = mintToken('FINANCE', { sub: crypto.randomUUID() });
  const finBefore = (await api('GET', '/depots/api/v1/depots/manage', { token: fin })).status;
  r = await api('PUT', '/auth/api/v1/access/builtin/FINANCE/disabled', { token: SA, body: { disabled: true } });
  check('FINANCE can be switched off (nobody holds it)', r.status === 204, `status ${r.status}`);
  const finOff = await until(async () => (await api('GET', '/depots/api/v1/depots/manage', { token: fin })).status === 403, 'FINANCE off');
  check('a switched-off role holds nothing (control: it did before)', finOff && finBefore === 200, `before ${finBefore}`);
  r = await api('PUT', '/auth/api/v1/access/builtin/FINANCE/disabled', { token: SA, body: { disabled: false } });
  check('and can be switched back on', r.status === 204 && (await until(async () => (await api('GET', '/depots/api/v1/depots/manage', { token: fin })).status === 200, 'FINANCE on')));

  // ---- 7. audit trail ------------------------------------------------------------------------
  const audit = sql('hydromart_auth', `select string_agg(distinct action, ',' order by action) from audit_logs where action like 'access.%' and "createdAt" > now() - interval '30 minutes'`);
  for (const a of ['access.role.created', 'access.matrix.changed', 'access.depotOverride.set', 'access.depotOverride.reset', 'access.builtin.disabled', 'access.builtin.enabled']) {
    check(`audit trail has ${a}`, audit.includes(a));
  }

  // ---- cleanup ----------------------------------------------------------------------------------
  await api('PUT', '/auth/api/v1/access/matrix/orderManageRead', { token: SA, body: { roles: holders } });
  if (!holders.length) await api('DELETE', '/auth/api/v1/access/matrix/orderManageRead', { token: SA });
  if (acct) {
    sql('hydromart_auth', `delete from refresh_tokens where "customerId"='${acct}'; delete from customers where id='${acct}'`);
    try { sql('hydromart_hr', `delete from employees where "authSubjectId"='${acct}'`); } catch { /* hr schema name differs */ }
  }
  for (const k of [KEY, copyKey].filter(Boolean)) {
    sql('hydromart_auth', `update capability_overrides set roles = array_remove(roles,'${k}'); delete from capability_depot_overrides where "roleKey"='${k}'; delete from custom_roles where key='${k}'`);
  }
  sql('hydromart_auth', `delete from role_settings where "roleKey"='FINANCE'`);
}

main()
  .catch((e) => {
    console.error(e);
    failed += 1;
  })
  .finally(() => {
    console.log(`\n${rows.length - failed}/${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`);
    process.exit(failed ? 1 : 0);
  });
