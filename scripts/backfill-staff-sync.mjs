// Reconcile the two staff lists for data written before they created each other.
//
//   node scripts/backfill-staff-sync.mjs --dry-run
//   node scripts/backfill-staff-sync.mjs
//
// This release makes an employee and a login account one person, created together from
// either side. Everything written BEFORE it is still split, and so is anything left behind
// by a write that failed between the two services. The console badges surface those rows
// one by one; this does the bulk pass.
//
// What it does, and what it deliberately does not:
//
//   1. employee WITH a jabatan and no account  -> mints the account (POST employees/:id/account)
//   2. employee with NO jabatan                -> REPORTED, never guessed. Which role somebody
//                                                 holds decides what they may do in 18 services;
//                                                 a script must not decide that.
//   3. staff account with no employee row      -> REPORTED. Creating one needs a salary and a
//                                                 join date, and an invented salary is worse
//                                                 than a row somebody has to fill in. Fix it
//                                                 from the badge on /hq/staff.
//   4. Employee.supervisorId still set         -> copied into depot-service's staff_supervision,
//                                                 which is where a reporting line lives now.
//
// Idempotent, like scripts/seed-hierarchy.mjs: every step is a no-op once it has run, so a
// half-finished run is safe to repeat. Drives the real gateway over HTTP — no DB access,
// just an up stack.
//
// Env:
//   GATEWAY_URL         default http://localhost:8080
//   JWT_ACCESS_SECRET   MUST equal the stack's shared JWT secret
import crypto from 'node:crypto';

import { fetchThrottled, listAllPages } from './lib/http.mjs';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!JWT_SECRET) {
  console.error('JWT_ACCESS_SECRET is required (must match the running stack).');
  process.exit(1);
}

/** A SUPER_ADMIN token: this touches the staff directory, HR and the hierarchy. */
function token() {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: '00000000-0000-4000-8000-00000000dead',
    role: 'SUPER_ADMIN',
    phone: null,
    depotId: null,
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

const AUTH = { Authorization: `Bearer ${token()}`, 'content-type': 'application/json' };

async function get(path) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, { headers: AUTH });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function put(path, body) {
  const res = await fetchThrottled(`${GATEWAY}${path}`, {
    method: 'PUT',
    headers: AUTH,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
}

async function main() {
  // K-6: both endpoints cap their page at 100, so the "permanent net" used to 400 on its
  // first two calls and reconcile nothing at all. Paged at the cap instead — this walks the
  // whole directory, which is the point of a backfill.
  const employees = await listAllPages(
    async (page, pageSize) =>
      (await get(`/employees/api/v1/employees?page=${page}&pageSize=${pageSize}`)).rows ?? [],
  );
  const staff = await listAllPages(
    async (page, pageSize) =>
      (await get(`/auth/api/v1/auth/staff?page=${page}&limit=${pageSize}`)).items ?? [],
  );
  console.log(`${employees.length} karyawan, ${staff.length} akun staf.`);

  // 1 + 2 — employees with no login.
  const unlinked = employees.filter((e) => !e.authSubjectId && e.status !== 'RESIGNED');
  const mintable = unlinked.filter((e) => e.role);
  const roleless = unlinked.filter((e) => !e.role);

  console.log(`\n[1] ${mintable.length} karyawan bisa dibuatkan akun.`);
  for (const e of mintable) {
    if (DRY_RUN) {
      console.log(`  (dry-run) ${e.employeeCode} ${e.fullName} -> ${e.role}`);
      continue;
    }
    try {
      await post(`/employees/api/v1/employees/${e.id}/account`);
      console.log(`  OK  ${e.employeeCode} ${e.fullName} -> ${e.role}`);
    } catch (err) {
      console.log(`  GAGAL ${e.employeeCode} ${e.fullName}: ${err.message}`);
    }
  }

  if (roleless.length > 0) {
    console.log(`\n[2] ${roleless.length} karyawan TANPA jabatan — tidak ditebak, isi manual:`);
    for (const e of roleless) console.log(`  ${e.employeeCode} ${e.fullName} (${e.phone})`);
  }

  // 3 — accounts with no employee row. Reported only; the badge on /hq/staff opens a
  // prefilled form, because salary and join date are not this script's to invent.
  const linked = new Set(employees.map((e) => e.authSubjectId).filter(Boolean));
  const orphanAccounts = staff.filter(
    (s) => !linked.has(s.id) && s.role !== 'FRANCHISE_OWNER' && s.status !== 'DELETED',
  );
  if (orphanAccounts.length > 0) {
    console.log(`\n[3] ${orphanAccounts.length} akun staf tanpa data karyawan — lengkapi di /hq/staff:`);
    for (const s of orphanAccounts) console.log(`  ${s.fullName ?? '(tanpa nama)'} ${s.phone} (${s.role})`);
  }

  // 4 — reporting lines still living in the old column.
  const byId = new Map(employees.map((e) => [e.id, e]));
  const legacyLinks = employees.filter((e) => e.supervisorId && e.authSubjectId);
  console.log(`\n[4] ${legacyLinks.length} tautan atasan lama untuk dipindah.`);
  for (const e of legacyLinks) {
    const boss = byId.get(e.supervisorId);
    if (!boss?.authSubjectId) {
      console.log(`  LEWAT ${e.employeeCode}: atasannya belum punya akun`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  (dry-run) ${e.employeeCode} -> ${boss.employeeCode}`);
      continue;
    }
    try {
      await put(`/depots/api/v1/staff-hierarchy/${e.authSubjectId}/superior`, {
        superiorId: boss.authSubjectId,
      });
      console.log(`  OK  ${e.employeeCode} -> ${boss.employeeCode}`);
    } catch (err) {
      console.log(`  GAGAL ${e.employeeCode}: ${err.message}`);
    }
  }

  if (DRY_RUN) console.log('\n--dry-run: tidak ada yang ditulis.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
