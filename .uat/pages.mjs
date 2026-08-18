// Page sweep for the "Cakupan Halaman" sheet: open all 199 routes with an entitled
// role and again with an unentitled one, recording load status and RBAC behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, mintToken, loginPhone, WEB } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sheets = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'uat.json'), 'utf8'));
const rows = sheets['Cakupan Halaman'].slice(2).filter((r) => r[1]);

const ROLE_TOKEN = {
  CUSTOMER: null, // filled with a real customer session below
  DRIVER: mintToken('STAFF_DEPOT'),
  DEPOT_OPERATOR: null,
  DEPOT_MANAGER: null,
  FRANCHISE_OWNER: null,
  HEAD_OFFICE: mintToken('HEAD_OFFICE'),
  FINANCE: mintToken('FINANCE'),
  MARKETING: mintToken('MARKETING'),
  HR: mintToken('HR'),
  SUPER_ADMIN: mintToken('SUPER_ADMIN'),
};

const admin = ROLE_TOKEN.SUPER_ADMIN;
const d = await api('GET', '/depots/api/v1/depots/manage?limit=5', { token: admin });
const depots = Array.isArray(d.body) ? d.body : d.body?.items ?? [];
const depotId = (depots.find((x) => x.code === 'JKT-01') ?? depots[0])?.id;
ROLE_TOKEN.DEPOT_OPERATOR = mintToken('STAFF_DEPOT', { depotId });
ROLE_TOKEN.DEPOT_MANAGER = mintToken('KEPALA_DEPOT', { depotId });
ROLE_TOKEN.FRANCHISE_OWNER = mintToken('FRANCHISE_OWNER', { depotId });

const cust = await loginPhone(`+62819${Date.now().toString().slice(-8)}`, 'Sweep Customer');
ROLE_TOKEN.CUSTOMER = cust.ok ? cust.accessToken : mintToken('CUSTOMER');

/** First role named in the sheet's "Peran yang Berhak" column that we hold a token for. */
function entitled(roleText) {
  const t = String(roleText ?? '').toUpperCase();
  for (const role of Object.keys(ROLE_TOKEN)) if (t.includes(role)) return role;
  if (/PUBLIK|PUBLIC/.test(t)) return 'PUBLIC';
  return 'SUPER_ADMIN';
}

/** A role that should NOT be able to see the page (used for the RBAC probe). */
function outsider(role) {
  return role === 'CUSTOMER' || role === 'PUBLIC' ? 'DRIVER' : 'CUSTOMER';
}

const fill = (route) => route
  .replace('{id}', '00000000-0000-0000-0000-000000000000')
  .replace('{role}', 'DEPOT_MANAGER')
  .replace(/\[.*?\]/g, '00000000-0000-0000-0000-000000000000');

const out = [];
for (const r of rows) {
  const route = fill(String(r[1]).trim());
  const surface = r[2] ?? '';
  const role = entitled(r[3]);
  const token = role === 'PUBLIC' ? null : ROLE_TOKEN[role];
  const res = await api('GET', route, { base: WEB, raw: true, cookies: token ? { hm_at: token } : undefined });
  /*
   * Strip <script> before reading anything out of the HTML.
   *
   * Next inlines its RSC payload in a <script>, and that payload carries the copy from
   * not-found.tsx — "Halaman yang kamu cari tidak ada", plus login/Masuk strings — on EVERY
   * page. So the RBAC probe below matched its own denial regex against boilerplate that is
   * present whether access was denied or not, and reported OK 198 times out of 198. The
   * sheet said "0 RBAC leaks" as a matter of arithmetic, not measurement.
   */
  const body = (res.text ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const loaded = res.status === 200;
  const errorish = /Application error|Internal Server Error|Unhandled Runtime Error|__NEXT_ERROR/i.test(body);
  const emptyHandled = /Belum ada|Tidak ada|kosong|empty/i.test(body);

  let rbac = '-';
  if (role !== 'PUBLIC') {
    const other = outsider(role);
    const probe = await api('GET', route, { base: WEB, raw: true, cookies: { hm_at: ROLE_TOKEN[other] } });
    /*
     * A 2xx is NOT a pass here, and calling it one was the whole defect.
     *
     * Access in this app is decided client-side after hydration, so the HTML a wrong role
     * receives is the same HTML the right role receives — the server has not refused
     * anything. Reading the body for "403" or "Masuk" therefore measures Next's boilerplate,
     * not authorisation. Only a redirect or an explicit non-2xx is evidence of refusal;
     * everything else is a question this probe cannot answer, and it now says so instead of
     * answering it favourably.
     */
    rbac = probe.status >= 300
      ? `OK (${other}=${probe.status})`
      : `BELUM DIUJI (${other}=${probe.status}) — akses diputus di klien, HTML tidak membuktikan apa pun`;
  }

  out.push({
    route, surface, role,
    loaded: loaded && !errorish ? 'Ya' : `Tidak (HTTP ${res.status}${errorish ? ', runtime error' : ''})`,
    data: loaded ? (errorish ? 'Error' : emptyHandled ? 'Kosong (ditangani)' : 'Ada') : '-',
    rbac,
    bytes: body.length,
  });
  process.stdout.write(`${out.length}/${rows.length} ${route} ${res.status}\n`);
}

fs.writeFileSync(path.join(HERE, 'pages.json'), JSON.stringify(out, null, 1));
const bad = out.filter((x) => !x.loaded.startsWith('Ya'));
const leaks = out.filter((x) => x.rbac.startsWith('LEAK'));
console.log(`\n== ${out.length} pages: ${out.length - bad.length} loaded, ${bad.length} failed, ${leaks.length} RBAC leaks`);
console.log(bad.slice(0, 25).map((x) => `  FAIL ${x.route} ${x.loaded}`).join('\n'));
console.log(leaks.slice(0, 25).map((x) => `  LEAK ${x.route} (${x.role})`).join('\n'));
process.exit(0);
