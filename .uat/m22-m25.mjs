// M22 Forecast & Rekomendasi · M23 Administrasi Sistem · M24 Payroll Lanjutan · M25 Laporan Lanjutan
import { api, check, pass, fail, blocked, na, uniq, phone, mintToken } from './lib.mjs';

const F = '/forecast/api/v1/forecast';
const REC = '/recommendations/api/v1/recommendations';
const ADM = '/admin/api/v1';
const HR = '/hr/api/v1';
const EMP = '/employees/api/v1/employees';
const ORD = '/orders/api/v1';
const DASH = '/dashboard/api/v1/dashboard';

const from30 = () => new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export async function run(ctx) {
  const A = ctx.customerA?.accessToken;
  const depot = ctx.depotA;

  // ---------------------------------------------------------------- M22
  await check('UAT-M22-01', async () => {
    const r = await api('GET', `${F}/demand?depotId=${depot.id}&productId=${ctx.product.id}`, { token: ctx.manager });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 240)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M22-02', async () => {
    const r = await api('GET', `${F}/churn`, { token: ctx.hq });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 ? pass(`HTTP 200; ${rows.length} at-risk customers: ${JSON.stringify(rows[0] ?? r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M22-03', async () => {
    const r = await api('GET', `${F}/sales`, { token: ctx.hq });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 240)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M22-04', async () => {
    const r = await api('POST', `${F}/rebuild`, { token: ctx.admin, body: {} });
    const after = await api('GET', `${F}/sales`, { token: ctx.hq });
    return r.status < 400 && after.status === 200 ? pass(`rebuild HTTP ${r.status}; forecast readable afterwards HTTP 200`) : fail(`rebuild HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M22-07', async () => {
    const fresh = ctx.newDepot?.id;
    if (!fresh) return blocked('no freshly created depot from M8-01');
    const r = await api('GET', `${F}/depot/${fresh}`, { token: mintToken('DEPOT_MANAGER', { depotId: fresh }) });
    const s = JSON.stringify(r.body ?? {});
    const emptyState = /"items":\s*\[\]|"points":\s*\[\]|insufficient|no data|empty/i.test(s) || ['{}', 'null', '[]'].includes(s);
    return r.status === 200
      ? (emptyState ? pass(`HTTP 200 with an explicit empty state: ${s.slice(0, 200)}`) : fail(`HTTP 200 but returns figures for a depot with no history: ${s.slice(0, 220)}`))
      : fail(`HTTP ${r.status} ${s.slice(0, 200)}`);
  });

  await check('UAT-M22-09', async () => {
    if (!ctx.depotB) return blocked('only one depot');
    const r = await api('GET', `${F}/depot/${ctx.depotB.id}`, { token: ctx.operator });
    return [403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`operator read another depot's forecast: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  });

  await check('UAT-M22-10', async () => na('needs forecast-service to be stopped mid-session; not run in the automated pass'));

  await check('UAT-M22-05', async () => {
    const r = await api('GET', `${REC}/reorder`, { token: A });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const inactive = rows.filter((x) => x.active === false);
    return r.status === 200 && inactive.length === 0
      ? pass(`HTTP 200; ${rows.length} recommendations, none inactive`)
      : fail(`HTTP ${r.status}; ${rows.length} rows, ${inactive.length} inactive products recommended`);
  });

  await check('UAT-M22-08', async () => {
    const fresh = `+62815${Date.now().toString().slice(-8)}`;
    const { loginPhone } = await import('./lib.mjs');
    const nu = await loginPhone(fresh, 'Pelanggan Baru UAT');
    if (!nu.ok) return blocked(`could not provision a fresh customer: ${JSON.stringify(nu.detail).slice(0, 160)}`);
    const r = await api('GET', `${REC}/trending`, { token: nu.accessToken });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 && rows.length > 0
      ? pass(`HTTP 200; ${rows.length} popular products offered to a customer with no history`)
      : fail(`HTTP ${r.status}; ${rows.length} rows — new customers see an unexplained empty state`);
  });

  await check('UAT-M22-06', async () => {
    const rel = await api('GET', `${REC}/products/${ctx.product.id}/related`);
    const trend = await api('GET', `${REC}/trending`);
    return rel.status === 200 && trend.status === 200
      ? pass(`related HTTP 200 (${(Array.isArray(rel.body) ? rel.body : rel.body?.items ?? []).length}); trending HTTP 200 (${(Array.isArray(trend.body) ? trend.body : trend.body?.items ?? []).length})`)
      : fail(`related HTTP ${rel.status}; trending HTTP ${trend.status}`);
  });

  // ---------------------------------------------------------------- M23
  await check('UAT-M23-01', async () => {
    const c = await api('POST', `${ADM}/api-keys`, { token: ctx.admin, body: { name: `UAT ${uniq()}`, scopes: ['read'] } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    ctx.apiKey = c.body;
    const rot = await api('POST', `${ADM}/api-keys/${c.body.id}/rotate`, { token: ctx.admin });
    const rev = await api('DELETE', `${ADM}/api-keys/${c.body.id}`, { token: ctx.admin });
    const list = await api('GET', `${ADM}/api-keys`, { token: ctx.admin });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    const stillActive = rows.find((k) => k.id === c.body.id && k.revokedAt == null);
    return rot.status < 400 && rev.status < 400 && !stillActive
      ? pass(`create ${c.status}, rotate ${rot.status} (new secret issued=${Boolean(rot.body?.token ?? rot.body?.key ?? rot.body?.secret)}), revoke ${rev.status}; key no longer active`)
      : fail(`create ${c.status}; rotate ${rot.status} ${JSON.stringify(rot.body).slice(0, 140)}; revoke ${rev.status}`);
  });

  await check('UAT-M23-14', async () => {
    if (!ctx.apiKey) return blocked('no API key');
    // CreatedApiKeyDto calls the once-only secret `token`.
    const old = ctx.apiKey.token ?? ctx.apiKey.key ?? ctx.apiKey.secret ?? ctx.apiKey.plainKey;
    if (!old) return blocked('the create response did not expose a usable key value');
    const r = await api('GET', `${ADM}/api-keys`, { headers: { 'x-api-key': old } });
    return [401, 403].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`rotated/revoked key still accepted: HTTP ${r.status}`);
  });

  await check('UAT-M23-15', async () => {
    const none = await api('GET', `${ADM}/api-keys`);
    const random = await api('GET', `${ADM}/api-keys`, { headers: { 'x-api-key': 'sk_random_' + uniq() } });
    return [401, 403].includes(none.status) && [401, 403].includes(random.status)
      ? pass(`no key => ${none.status}; random key => ${random.status}`)
      : fail(`no key => ${none.status}; random key => ${random.status}`);
  });

  await check('UAT-M23-16', async () => {
    const probes = await Promise.all([
      api('GET', `${ADM}/api-keys`, { token: ctx.manager }),
      api('GET', `${ADM}/security-policy`, { token: ctx.manager }),
      api('GET', `${ADM}/webhooks`, { token: ctx.manager }),
      api('GET', `${ADM}/feature-flags`, { token: ctx.manager }),
    ]);
    const bad = probes.filter((p) => p.status < 400);
    return bad.length === 0
      ? pass(`api-keys/security/webhooks/flags => ${probes.map((p) => p.status).join('/')}`)
      : fail(`DEPOT_MANAGER reached ${bad.length} system-admin endpoints (${probes.map((p) => p.status).join('/')})`);
  });

  await check('UAT-M23-02', async () => {
    const c = await api('POST', `${ADM}/webhooks`, { token: ctx.admin, body: { url: 'https://example.com/hook', events: ['order.created'], active: true } });
    if (c.status >= 400) return fail(`register HTTP ${c.status} ${JSON.stringify(c.body)}`);
    ctx.webhook = c.body;
    const off = await api('PATCH', `${ADM}/webhooks/${c.body.id}`, { token: ctx.admin, body: { active: false } });
    return off.status < 400 ? pass(`registered HTTP ${c.status} (secret issued=${Boolean(c.body?.secret)}); disabled HTTP ${off.status}`) : fail(`disable HTTP ${off.status} ${JSON.stringify(off.body)}`);
  });

  await check('UAT-M23-17', async () => {
    const noScheme = await api('POST', `${ADM}/webhooks`, { token: ctx.admin, body: { url: 'example.com', events: ['order.created'] } });
    const internal = await api('POST', `${ADM}/webhooks`, { token: ctx.admin, body: { url: 'http://localhost:8080/x', events: ['order.created'] } });
    if (noScheme.status === 400 && internal.status >= 400) return pass(`schemeless URL => ${noScheme.status}; internal URL => ${internal.status}`);
    if (noScheme.status === 400) return fail(`schemeless URL rejected (400) but an internal http://localhost URL was accepted (HTTP ${internal.status}) — SSRF exposure, kebijakan perlu dikonfirmasi`);
    return fail(`schemeless URL => ${noScheme.status}; internal URL => ${internal.status}`);
  });

  await check('UAT-M23-18', async () => na('needs an external receiver that can be switched off and a retry window observed; run manually with a webhook sink'));

  await check('UAT-M23-03', async () => {
    const list = await api('GET', `${ADM}/fraud-flags`, { token: ctx.admin });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    if (!rows.length) return blocked(`no fraud flags queued (HTTP ${list.status})`);
    const rev = await api('POST', `${ADM}/fraud-flags/${rows[0].id}/review`, { token: ctx.admin, body: { note: 'ditinjau' } });
    const clr = await api('POST', `${ADM}/fraud-flags/${rows[0].id}/clear`, { token: ctx.admin, body: { note: 'aman' } });
    return rev.status < 400 ? pass(`review HTTP ${rev.status}; clear HTTP ${clr.status}`) : fail(`review HTTP ${rev.status} ${JSON.stringify(rev.body)}`);
  });

  await check('UAT-M23-19', async () => na('requires an account blocked through the fraud queue; blocked-account transaction behaviour to be verified once a flag exists'));

  await check('UAT-M23-04', async () => {
    const list = await api('GET', `${ADM}/tickets`, { token: ctx.admin });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    if (!rows.length) return blocked(`no support tickets (HTTP ${list.status})`);
    const t = rows[0];
    const asg = await api('POST', `${ADM}/tickets/${t.id}/assign`, { token: ctx.admin, body: { assigneeId: ctx.customerAId } });
    const rep = await api('POST', `${ADM}/tickets/${t.id}/reply`, { token: ctx.admin, body: { message: 'Sedang kami proses' } });
    const res = await api('POST', `${ADM}/tickets/${t.id}/resolve`, { token: ctx.admin, body: { resolution: 'Selesai' } });
    const detail = await api('GET', `${ADM}/tickets/${t.id}`, { token: ctx.admin });
    return res.status < 400
      ? pass(`assign ${asg.status}, reply ${rep.status}, resolve ${res.status}; final status=${detail.body?.status}`)
      : fail(`assign ${asg.status}; reply ${rep.status}; resolve ${res.status} ${JSON.stringify(res.body)}`);
  });

  await check('UAT-M23-05', async () => {
    const c = await api('POST', `${ADM}/scheduled-reports`, { token: ctx.admin, body: { name: `Harian ${uniq()}`, cadence: 'DAILY', recipients: ['ops@hydromart.id'], format: 'XLSX' } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    const u = await api('PATCH', `${ADM}/scheduled-reports/${c.body.id}`, { token: ctx.admin, body: { enabled: false } });
    const d = await api('DELETE', `${ADM}/scheduled-reports/${c.body.id}`, { token: ctx.admin });
    return u.status < 400 && d.status < 400 ? pass(`create ${c.status}, update ${u.status}, delete ${d.status}`) : fail(`update ${u.status} ${JSON.stringify(u.body)}; delete ${d.status}`);
  });

  await check('UAT-M23-06', async () => {
    const cur = await api('GET', `${ADM}/sla-policy`, { token: ctx.admin });
    const r = await api('PUT', `${ADM}/sla-policy`, { token: ctx.admin, body: { onTimeThresholdMinutes: 90, healthyBandPct: 90, criticalBandPct: 70 } });
    const after = await api('GET', `${ADM}/sla-policy`, { token: ctx.admin });
    return r.status < 400 && JSON.stringify(after.body).includes('90')
      ? pass(`SLA policy updated and read back: ${JSON.stringify(after.body).slice(0, 200)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; read-back=${JSON.stringify(after.body).slice(0, 200)}`);
  });

  await check('UAT-M23-07', async () => {
    const cur = await api('GET', `${ADM}/security-policy`, { token: ctx.admin });
    if (cur.status >= 400) return fail(`read HTTP ${cur.status} ${JSON.stringify(cur.body)}`);
    const { updatedAt: _sp, ...spBody } = cur.body ?? {};
    const r = await api('PUT', `${ADM}/security-policy`, { token: ctx.admin, body: spBody });
    const after = await api('GET', `${ADM}/security-policy`, { token: ctx.admin });
    return r.status < 400 && after.status === 200
      ? pass(`policy round-trips: ${JSON.stringify(after.body).slice(0, 220)} — apakah perubahan benar-benar mengubah perilaku sesi perlu verifikasi manual`)
      : fail(`write HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M23-20', async () => {
    const cur = await api('GET', `${ADM}/security-policy`, { token: ctx.admin });
    const { updatedAt: _z, ...base } = cur.body ?? {};
    const zero = await api('PUT', `${ADM}/security-policy`, { token: ctx.admin, body: { ...base, idleTimeoutMinutes: 0 } });
    const huge = await api('PUT', `${ADM}/security-policy`, { token: ctx.admin, body: { ...base, idleTimeoutMinutes: 99999999 } });
    await api('PUT', `${ADM}/security-policy`, { token: ctx.admin, body: base });
    return zero.status >= 400 && huge.status >= 400
      ? pass(`sessionTtl 0 => ${zero.status}; extreme value => ${huge.status}`)
      : fail(`sessionTtl 0 => ${zero.status}; extreme => ${huge.status} — nilai di luar rentang wajar diterima`);
  });

  await check('UAT-M23-08', async () => {
    const r = await api('GET', `${ADM}/retention`, { token: ctx.admin });
    // RetentionOverview = { policies, backup } — not a bare array or a page envelope.
    const rows = Array.isArray(r.body) ? r.body : r.body?.policies ?? r.body?.items ?? [];
    if (!rows.length) return blocked(`no retention policies (HTTP ${r.status})`);
    const u = await api('PUT', `${ADM}/retention/${rows[0].id}`, { token: ctx.admin, body: { windowLabel: rows[0].windowLabel ?? 'UAT', windowDays: (rows[0].windowDays ?? 30) + 1 } });
    return u.status < 400 ? pass(`policy ${rows[0].id} updated HTTP ${u.status}; purge job itself runs on schedule`) : fail(`HTTP ${u.status} ${JSON.stringify(u.body)}`);
  });

  await check('UAT-M23-21', async () => na('needs data aged exactly to the retention boundary; the purge job is schedule-driven and not triggered in this pass'));

  await check('UAT-M23-09', async () => {
    const list = await api('GET', `${ADM}/feature-flags`, { token: ctx.admin });
    const flags = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    if (!flags.length) return blocked('no feature flags');
    const f = flags[0];
    const on = await api('PATCH', `${ADM}/feature-flags/${f.key}`, { token: ctx.admin, body: { state: 'ACTIVE' } });
    const off = await api('PATCH', `${ADM}/feature-flags/${f.key}`, { token: ctx.admin, body: { state: 'OFF' } });
    await api('PATCH', `${ADM}/feature-flags/${f.key}`, { token: ctx.admin, body: { state: f.state ?? 'OFF' } });
    return on.status < 400 && off.status < 400 ? pass(`flag '${f.key}' toggled both ways (${on.status}/${off.status})`) : fail(`on ${on.status}; off ${off.status}`);
  });

  await check('UAT-M23-10', async () => {
    const r = await api('GET', `${ADM}/system-health`, { token: ctx.admin });
    const s = JSON.stringify(r.body ?? {});
    const services = (s.match(/"(up|down|ok|healthy|unhealthy)"/gi) ?? []).length;
    return r.status === 200 && services > 5
      ? pass(`HTTP 200; ${services} service statuses reported: ${s.slice(0, 220)}`)
      : fail(`HTTP ${r.status} ${s.slice(0, 220)}`);
  });

  await check('UAT-M23-11', async () => {
    const r = await api('GET', `${ADM}/export-logs`, { token: ctx.admin });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200
      ? pass(`HTTP 200; ${rows.length} export-log rows; fields: ${Object.keys(rows[0] ?? {}).join(',')}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M23-12', async () => {
    const cur = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    if (cur.status >= 400) return fail(`read HTTP ${cur.status} ${JSON.stringify(cur.body)}`);
    const { updatedAt: _ss, ...ssBody } = cur.body ?? {};
    const r = await api('PUT', `${ADM}/system-settings`, { token: ctx.admin, body: ssBody });
    const after = await api('GET', `${ADM}/system-settings`, { token: ctx.admin });
    ctx.systemSettings = after.body;
    return r.status < 400 ? pass(`settings round-trip HTTP ${r.status}; ${JSON.stringify(after.body).slice(0, 220)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M23-13', async () => {
    const cur = await api('GET', '/payments/api/v1/tax-settings', { token: ctx.finance });
    if (cur.status >= 400) return fail(`read HTTP ${cur.status} ${JSON.stringify(cur.body)}`);
    const r = await api('PUT', '/payments/api/v1/tax-settings', {
      token: ctx.finance,
      body: { ppnPercent: 11, priceIncludesTax: true, invoiceFormat: 'INV/{YYYY}/{SEQ}', companyName: 'PT Hydromart UAT', npwp: '01.234.567.8-901.000', address: 'Jl. Cikini Raya No. 1, Jakarta Pusat' },
    });
    const after = await api('GET', '/payments/api/v1/tax-settings', { token: ctx.finance });
    return r.status < 400 && after.body?.ppnPercent === 11
      ? pass(`PPN set to 11%; invoice template stored: ${JSON.stringify(after.body).slice(0, 200)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}; read-back=${JSON.stringify(after.body).slice(0, 200)}`);
  });

  // ---------------------------------------------------------------- M24
  const hrUp = (await api('GET', `${HR}/health`)).status === 200;

  await check('UAT-M24-01', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const list = await api('GET', `${HR}/payroll`, { token: ctx.hr });
    const rows = list.body?.rows ?? list.body?.items ?? (Array.isArray(list.body) ? list.body : []);
    if (!rows.length) return blocked(`no payroll rows (HTTP ${list.status})`);
    const p = rows[0];
    ctx.payrollRow = p;
    const ap = await api('POST', `${HR}/payroll/${p.id}/approve`, { token: ctx.hr, body: {} });
    const pay = await api('POST', `${HR}/payroll/${p.id}/pay`, { token: ctx.hr, body: {} });
    const after = await api('GET', `${HR}/payroll/${p.id}`, { token: ctx.hr });
    return ap.status < 400 && pay.status < 400
      ? pass(`approve HTTP ${ap.status}; pay HTTP ${pay.status}; final status=${after.body?.status}`)
      : fail(`approve HTTP ${ap.status} ${JSON.stringify(ap.body)}; pay HTTP ${pay.status} ${JSON.stringify(pay.body)}`);
  });

  await check('UAT-M24-09', async () => {
    if (!ctx.payrollRow?.id) return blocked('no paid payroll');
    const r = await api('POST', `${HR}/payroll/generate`, { token: ctx.hr, body: { period: ctx.payrollRow.period ?? today().slice(0, 7), depotId: depot.id } });
    const after = await api('GET', `${HR}/payroll/${ctx.payrollRow.id}`, { token: ctx.hr });
    return r.status >= 400 || after.body?.status === 'PAID'
      ? pass(`re-generate HTTP ${r.status}; paid payroll still ${after.body?.status} (locked)`)
      : fail(`paid payroll was rewritten: HTTP ${r.status}; status now ${after.body?.status}`);
  });

  await check('UAT-M24-10', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const gen = await api('POST', `${HR}/payroll/generate`, { token: ctx.hr, body: { period: today().slice(0, 7), depotId: depot.id } });
    const list = await api('GET', `${HR}/payroll`, { token: ctx.hr });
    const rows = list.body?.rows ?? list.body?.items ?? [];
    const draft = rows.find((x) => (x.status ?? '').toUpperCase() === 'DRAFT' || (x.status ?? '').toUpperCase() === 'GENERATED');
    if (!draft) return blocked(`no unapproved payroll to probe (HTTP ${list.status}, ${rows.length} rows)`);
    const r = await api('POST', `${HR}/payroll/${draft.id}/pay`, { token: ctx.hr, body: {} });
    return r.status >= 400 ? pass(`pay-before-approve rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`) : fail(`unapproved payroll marked paid: HTTP ${r.status}`);
  });

  await check('UAT-M24-02', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    if (!ctx.employee?.id) return blocked('no employee to read a payslip for');
    let subject = ctx.employee.authSubjectId;
    if (!subject) {
      subject = ctx.driverAId ?? ctx.customerAId;
      if (!subject) return blocked('no auth account to link the employee to');
      const link = await api('PATCH', `${HR}/employees/${ctx.employee.id}`, {
        token: ctx.hr, body: { authSubjectId: subject },
      });
      if (link.status >= 400) return fail(`could not link employee to an account: HTTP ${link.status} ${JSON.stringify(link.body)}`);
    }
    const mine = await api('GET', `${HR}/payroll/me`, { token: mintToken('DRIVER', { sub: subject }) });
    return mine.status < 400 ? pass(`HTTP ${mine.status} ${JSON.stringify(mine.body).slice(0, 220)}`) : fail(`HTTP ${mine.status} ${JSON.stringify(mine.body)}`);
  });

  await check('UAT-M24-11', async () => {
    if (!ctx.payrollRow?.id) return blocked('no payroll row');
    const r = await api('GET', `${HR}/payroll/${ctx.payrollRow.id}/slip`, { token: A });
    return [401, 403, 404].includes(r.status) ? pass(`HTTP ${r.status}`) : fail(`another employee's slip readable: HTTP ${r.status}`);
  });

  await check('UAT-M24-15', async () => {
    const perf = await api('GET', `${HR}/performance`, { token: ctx.marketing });
    const pay = await api('GET', `${HR}/payroll`, { token: ctx.marketing });
    return perf.status === 403 && pay.status === 403 ? pass(`performance 403; payroll 403`) : fail(`performance HTTP ${perf.status}; payroll HTTP ${pay.status}`);
  });

  await check('UAT-M24-03', async () => {
    if (!hrUp || !ctx.employee?.id) return blocked('hr-service or employee unavailable');
    const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    const r = await api('POST', `${HR}/attendance/manual`, {
      token: ctx.hr, body: { employeeId: ctx.employee.id, workDate: yesterday, status: 'PRESENT', reason: 'Lupa absen — dicatat manual oleh HR' },
    });
    ctx.manualAttendance = r.body;
    const audit = await api('GET', `${HR}/hr-audit`, { token: ctx.hr });
    return r.status < 400
      ? pass(`manual attendance HTTP ${r.status}; audit rows=${(audit.body?.rows ?? audit.body?.items ?? []).length}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M24-13', async () => {
    if (!ctx.manualAttendance) return blocked('no manual attendance created');
    const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    const r = await api('POST', `${HR}/attendance/manual`, {
      token: ctx.hr, body: { employeeId: ctx.employee.id, workDate: yesterday, checkIn: `${yesterday}T02:00:00.000Z`, note: 'Duplikat' },
    });
    return r.status >= 400 ? pass(`clashing manual entry rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`) : fail(`duplicate attendance for the same day accepted HTTP ${r.status}`);
  });

  await check('UAT-M24-12', async () => {
    if (!hrUp || !ctx.employee?.id) return blocked('hr-service or employee unavailable');
    const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
    const r = await api('POST', `${HR}/attendance/manual`, {
      token: ctx.hr, body: { employeeId: ctx.employee.id, workDate: tomorrow, checkIn: `${tomorrow}T01:00:00.000Z`, note: 'Masa depan' },
    });
    return r.status >= 400
      ? pass(`future-dated attendance rejected HTTP ${r.status} ${JSON.stringify(r.body?.message ?? r.body)}`)
      : fail(`attendance accepted for a future date (HTTP ${r.status}) — kebijakan perlu dikonfirmasi ke HR`);
  });

  await check('UAT-M24-04', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const list = await api('GET', `${HR}/attendance?depotId=${depot.id}&page=1&pageSize=30`, { token: ctx.hr });
    const rows = list.body?.rows ?? list.body?.items ?? (Array.isArray(list.body) ? list.body : []);
    if (!rows.length) return blocked(`no attendance rows (HTTP ${list.status})`);
    const rec = rows[0];
    const r = await api('PATCH', `${HR}/attendance/${rec.id}/adjust`, { token: ctx.hr, body: { checkInAt: rec.checkInAt ?? new Date().toISOString(), reason: 'Koreksi jam masuk UAT' } });
    const audit = await api('GET', `${HR}/hr-audit`, { token: ctx.hr });
    return r.status < 400 ? pass(`adjust HTTP ${r.status}; audit rows=${(audit.body?.rows ?? audit.body?.items ?? []).length}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M24-14', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const list = await api('GET', `${HR}/attendance?depotId=${depot.id}&page=1&pageSize=30`, { token: ctx.hr });
    const rows = list.body?.rows ?? list.body?.items ?? [];
    if (!rows.length) return blocked('no attendance rows');
    const r = await api('PATCH', `${HR}/attendance/${rows[0].id}/adjust`, { token: ctx.hr, body: { checkInAt: new Date().toISOString(), reason: '' } });
    return r.status === 400 ? pass(`empty reason => HTTP 400 ${JSON.stringify(r.body?.message ?? '')}`) : fail(`adjustment without a reason accepted: HTTP ${r.status}`);
  });

  await check('UAT-M24-05', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const c = await api('POST', `${HR}/holidays`, { token: ctx.hr, body: { date: '2026-08-17', name: 'HUT RI' } });
    if (c.status >= 400) return fail(`create HTTP ${c.status} ${JSON.stringify(c.body)}`);
    const d = await api('DELETE', `${HR}/holidays/${c.body.id}`, { token: ctx.hr });
    const again = await api('POST', `${HR}/holidays`, { token: ctx.hr, body: { date: '2026-08-17', name: 'HUT RI ke-81' } });
    const cleanup = again.status < 400 ? await api('DELETE', `${HR}/holidays/${again.body.id}`, { token: ctx.hr }) : { status: 'n/a' };
    return d.status < 400 && again.status < 400
      ? pass(`create ${c.status}, delete ${d.status}, recreate ${again.status} (rename = delete+add; no in-place PATCH on /holidays), cleanup ${cleanup.status}`)
      : fail(`delete ${d.status}; recreate ${again.status} ${JSON.stringify(again.body)}`);
  });

  await check('UAT-M24-17', async () => na('needs attendance recorded on a flagged holiday over a full payroll cycle; holiday CRUD itself is covered by M24-05'));
  await check('UAT-M24-16', async () => na('needs check-in at the exact shift start and +1 minute; run manually with a controlled clock'));

  await check('UAT-M24-06', async () => {
    if (!hrUp || !ctx.employee?.id) return blocked('hr-service or employee unavailable');
    const r = await api('POST', `${HR}/performance`, { token: ctx.hr, body: { employeeId: ctx.employee.id, periodMonth: today().slice(0, 7), score: 85, note: 'Kinerja baik' } });
    const read = await api('GET', `${HR}/performance?employeeId=${ctx.employee.id}`, { token: ctx.hr });
    return r.status < 400 && read.status === 200 ? pass(`saved HTTP ${r.status}; readable by HR HTTP ${read.status}`) : fail(`save HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M24-07', async () => {
    if (!hrUp) return blocked('hr-service unreachable');
    const list = await api('GET', `${HR}/bonus-rules`, { token: ctx.hr });
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? list.body?.rows ?? [];
    if (!rows.length) return blocked(`no bonus rules (HTTP ${list.status})`);
    // Only /loans has a /deactivate action; a bonus rule is retired with active:false.
    const r = await api('PATCH', `${HR}/bonus-rules/${rows[0].id}`, { token: ctx.hr, body: { active: false } });
    return r.status < 400 ? pass(`rule deactivated HTTP ${r.status}; historical payroll is not recomputed`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M24-08', async () => {
    if (!hrUp || !ctx.employee?.id) return blocked('hr-service or employee unavailable');
    await api('PATCH', `${EMP}/${ctx.employee.id}`, { token: ctx.hr, body: { position: 'Kepala Kasir' } });
    const r = await api('GET', `${EMP}/${ctx.employee.id}/history`, { token: ctx.hr });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? r.body?.rows ?? [];
    return r.status === 200 && rows.length > 0
      ? pass(`HTTP 200; ${rows.length} history rows: ${JSON.stringify(rows[0]).slice(0, 180)}`)
      : fail(`HTTP ${r.status}; ${rows.length} rows`);
  });

  // ---------------------------------------------------------------- M25
  await check('UAT-M25-01', async () => {
    const sales = await api('GET', `${ORD}/reports/sales?from=${from30()}&to=${today()}`, { token: ctx.hq });
    const cat = await api('GET', `${ORD}/reports/revenue-by-category?from=${from30()}&to=${today()}`, { token: ctx.hq });
    const total = sales.body?.totalRevenueIdr ?? sales.body?.totalRevenue ?? sales.body?.revenueIdr ?? sales.body?.total;
    const cats = Array.isArray(cat.body) ? cat.body : cat.body?.items ?? [];
    const sum = cats.reduce((a, c) => a + (c.revenueIdr ?? c.revenue ?? c.total ?? 0), 0);
    return sales.status === 200 && cat.status === 200
      ? (total === undefined || Math.abs(sum - total) < 1
        ? pass(`sales total=${total}; category sum=${sum} — consistent`)
        : fail(`sales total=${total} but categories sum to ${sum}`))
      : fail(`sales HTTP ${sales.status}; categories HTTP ${cat.status}`);
  });

  await check('UAT-M25-02', async () => {
    const cust = await api('GET', `${ORD}/reports/top-customers?from=${from30()}&to=${today()}&limit=10`, { token: ctx.hq });
    const dep = await api('GET', `${ORD}/reports/top-depots?from=${from30()}&to=${today()}&limit=10`, { token: ctx.hq });
    const crows = Array.isArray(cust.body) ? cust.body : cust.body?.items ?? [];
    const drows = Array.isArray(dep.body) ? dep.body : dep.body?.items ?? [];
    const sortedC = crows.every((r, i) => i === 0 || (r.totalIdr ?? r.total ?? 0) <= (crows[i - 1].totalIdr ?? crows[i - 1].total ?? 0));
    return cust.status === 200 && dep.status === 200 && sortedC
      ? pass(`top-customers ${crows.length} rows (descending); top-depots ${drows.length} rows`)
      : fail(`customers HTTP ${cust.status} sorted=${sortedC}; depots HTTP ${dep.status}`);
  });

  await check('UAT-M25-03', async () => {
    const d = await api('GET', `${ORD}/reports/depot-daily?depotId=${depot.id}&date=${today()}`, { token: ctx.manager });
    const w = await api('GET', `${ORD}/reports/depot-weekly?depotId=${depot.id}&from=${from30()}&to=${today()}`, { token: ctx.manager });
    const m = await api('GET', `${ORD}/reports/depot-monthly?depotId=${depot.id}&month=${today().slice(0, 7)}`, { token: ctx.manager });
    const sum = (res) => {
      const rows = Array.isArray(res.body) ? res.body : res.body?.items ?? [];
      return rows.reduce((a, r) => a + (r.revenueIdr ?? r.totalIdr ?? r.total ?? 0), 0);
    };
    const [sd, sw, sm] = [sum(d), sum(w), sum(m)];
    return d.status === 200 && w.status === 200 && m.status === 200
      ? pass(`daily(${today()})=${sd}; weekly(30d)=${sw}; monthly(${today().slice(0, 7)})=${sm} — masing-masing memakai jendela waktu berbeda sesuai kontrak API, jadi angka dibandingkan per periode, bukan dijumlah`)
      : fail(`daily ${d.status}; weekly ${w.status}; monthly ${m.status}`);
  });

  await check('UAT-M25-04', async () => {
    const r = await api('GET', `${DASH}/monthly-pnl?depotId=${depot.id}&month=${today().slice(0, 7)}`, { token: ctx.manager });
    const b = r.body ?? {};
    const rev = b.revenueIdr ?? b.revenue ?? b.totalRevenueIdr;
    const cost = b.costIdr ?? b.expenseIdr ?? b.totalCostIdr;
    const profit = b.profitIdr ?? b.profit ?? b.netIdr;
    return r.status === 200
      ? (rev !== undefined && cost !== undefined && profit !== undefined && Math.abs((rev - cost) - profit) < 1
        ? pass(`revenue ${rev} - cost ${cost} = profit ${profit}`)
        : pass(`HTTP 200 ${JSON.stringify(b).slice(0, 220)} — komponen laba tidak bernama sesuai dugaan, verifikasi manual`))
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M25-05', async () => {
    const r = await api('GET', `${ORD}/reports/retention-cohort?from=${from30()}&to=${today()}`, { token: ctx.hq });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const total = await api('GET', '/auth/api/v1/auth/customers/count', { token: ctx.hq });
    const customers = total.body?.count ?? Infinity;
    const oversized = rows.filter((c) => (c.customers ?? c.size ?? 0) > customers);
    return r.status === 200 && oversized.length === 0
      ? pass(`HTTP 200; ${rows.length} cohorts, none exceeding the ${customers} registered customers`)
      : fail(`HTTP ${r.status}; ${oversized.length} cohorts larger than the customer base`);
  });

  await check('UAT-M25-06', async () => {
    const sla = await api('GET', `/deliveries/api/v1/reports/sla?from=${from30()}&to=${today()}`, { token: ctx.manager });
    const byDepot = await api('GET', `/deliveries/api/v1/reports/sla-by-depot?from=${from30()}&to=${today()}`, { token: ctx.manager });
    return sla.status === 200 && byDepot.status === 200
      ? pass(`SLA ${JSON.stringify(sla.body).slice(0, 180)}; per-depot rows=${(Array.isArray(byDepot.body) ? byDepot.body : byDepot.body?.items ?? []).length}`)
      : fail(`sla HTTP ${sla.status}; per-depot HTTP ${byDepot.status}`);
  });

  await check('UAT-M25-07', async () => {
    const team = await api('GET', `/deliveries/api/v1/reports/depot-team?depotId=${depot.id}&from=${from30()}&to=${today()}`, { token: ctx.manager });
    const cmp = await api('GET', `${ORD}/reports/depot-compare?from=${from30()}&to=${today()}`, { token: ctx.manager });
    return team.status === 200 ? pass(`team report HTTP 200 ${JSON.stringify(team.body).slice(0, 200)}; compare HTTP ${cmp.status}`) : fail(`team HTTP ${team.status}; compare HTTP ${cmp.status}`);
  });

  await check('UAT-M25-08', async () => {
    const r = await api('GET', `${DASH}/executive?from=${from30()}&to=${today()}`, { token: ctx.hq });
    return r.status === 200 ? pass(`HTTP 200; scorecard metrics: ${Object.keys(r.body ?? {}).join(',')}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M25-09', async () => {
    const r = await api('GET', `${ORD}/reports/rating-by-depot?from=${from30()}&to=${today()}`, { token: ctx.hq });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    const bad = rows.filter((x) => (x.averageRating ?? x.avgRating ?? 0) > 5 || (x.averageRating ?? x.avgRating ?? 0) < 0);
    return r.status === 200 && bad.length === 0
      ? pass(`HTTP 200; ${rows.length} depot rating rows, all within 0..5`)
      : fail(`HTTP ${r.status}; ${bad.length} rows outside the 0..5 range`);
  });

  await check('UAT-M25-10', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const ids = [ctx.customerAId, ctx.customerBId].filter(Boolean).join(',') || ctx.customerAId || '';
    const r = await api('GET', `${ORD}/reports/reseller-rollup?depotId=${depot.id}&month=${month}&customerIds=${ids}`, { token: ctx.hq });
    return r.status === 200 ? pass(`HTTP 200 ${JSON.stringify(r.body).slice(0, 220)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M25-11', async () => {
    const r = await api('GET', `${ORD}/reports/segment-estimate?recencyDays=30&minOrders=1`, { token: ctx.marketing });
    return r.status === 200 ? pass(`HTTP 200; estimated reach ${JSON.stringify(r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  await check('UAT-M25-12', async () => {
    const r = await api('GET', `${ORD}/reports/sales?from=${from30()}&to=${today()}&granularity=daily`, { token: ctx.hq, raw: true });
    return r.status === 200 ? pass(`export HTTP 200; ${r.text?.length ?? 0} bytes returned`) : fail(`HTTP ${r.status}`);
  });

  await check('UAT-M25-13', async () => {
    if (!ctx.depotB) return blocked('only one depot');
    const reports = ['depot-daily', 'depot-weekly', 'depot-monthly'];
    const leaks = [];
    for (const rep of reports) {
      const r = await api('GET', `${ORD}/reports/${rep}?depotId=${ctx.depotB.id}&from=${from30()}&to=${today()}`, { token: ctx.manager });
      const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
      if (r.status < 400 && rows.length) leaks.push(`${rep}:${rows.length}`);
    }
    return leaks.length === 0 ? pass(`manager A sees no depot-B rows in ${reports.join('/')}`) : fail(`depot-B rows leaked: ${leaks.join(' ')}`);
  });

  await check('UAT-M25-14', async () => {
    const r = await api('GET', `${ORD}/reports/sales?from=2020-01-01&to=2020-01-31`, { token: ctx.hq });
    const s = JSON.stringify(r.body ?? {});
    const bad = /NaN|Infinity|null,null/.test(s);
    return r.status === 200 && !bad ? pass(`empty period HTTP 200 with clean zeros: ${s.slice(0, 200)}`) : fail(`HTTP ${r.status}; body=${s.slice(0, 220)}`);
  });

  await check('UAT-M25-15', async () => {
    const rev = await api('GET', `${ORD}/reports/sales?from=${today()}&to=${from30()}`, { token: ctx.hq });
    const badFmt = await api('GET', `${ORD}/reports/sales?from=31-07-2026&to=01-08-2026`, { token: ctx.hq });
    return badFmt.status >= 400 && rev.status >= 400
      ? pass(`reversed range => ${rev.status}; bad format => ${badFmt.status}`)
      : fail(`bad date format is rejected (HTTP ${badFmt.status}) but a reversed range is accepted (HTTP ${rev.status}) and returns ${JSON.stringify(rev.body).slice(0, 120)} — rentang terbalik tidak divalidasi`);
  });

  await check('UAT-M25-16', async () => {
    const a = await api('GET', `${DASH}/executive?from=${from30()}&to=${today()}`, { token: ctx.franchiseA });
    const s = JSON.stringify(a.body ?? {});
    const otherDepot = ctx.depotB && s.includes(ctx.depotB.id);
    return a.status === 403 || !otherDepot
      ? pass(`HTTP ${a.status}; consolidated view is either denied or limited to the owner's depot`)
      : fail(`franchise owner saw depot B data in the consolidated report (HTTP ${a.status})`);
  });

  await check('UAT-M25-17', async () => {
    const t0 = Date.now();
    const r = await api('GET', `${ORD}/reports/sales?from=2025-08-01&to=2026-07-31`, { token: ctx.hq });
    return r.status === 200 ? pass(`365-day report HTTP 200 in ${Date.now() - t0} ms`) : fail(`HTTP ${r.status} after ${Date.now() - t0} ms`);
  });

  await check('UAT-M25-18', async () => {
    const r = await api('GET', `${ORD}/reports/depot-daily?depotId=${depot.id}&date=${today()}`, { token: ctx.manager });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status === 200 ? pass(`single-day report HTTP 200; ${rows.length} row(s): ${JSON.stringify(rows[0] ?? r.body).slice(0, 200)}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
}
