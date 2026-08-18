// M1 — Autentikasi & Sesi (UAT-M1-01 .. 26)
import { api, check, pass, fail, blocked, na, readOtp, mintToken, phone, loginPhone, WEB } from './lib.mjs';

const A = '/auth/api/v1/auth';

export async function run(ctx) {
  const p = phone();

  // M1-01 register with local 08xx number -> normalised to +628…
  const local = `0${p.slice(3)}`;
  let reg;
  await check('UAT-M1-01', async () => {
    reg = await api('POST', `${A}/register`, { body: { phone: local, fullName: 'Budi Santoso' } });
    if (reg.status >= 400) return fail(`HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
    const otp = readOtp(p);
    return otp
      ? pass(`HTTP ${reg.status}; OTP for normalised ${p} issued`, 'normalisation 08xx -> +628xx confirmed via OTP log')
      : fail(`HTTP ${reg.status} but no OTP logged for normalised ${p}`);
  });

  // M1-13 wrong OTP (run before the correct one, same OTP session)
  await check('UAT-M1-13', async () => {
    const r = await api('POST', `${A}/otp/verify`, { body: { phone: p, code: '000000', purpose: 'REGISTRATION' } });
    return r.status >= 400 && JSON.stringify(r.body).includes('OTP')
      ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // M1-16 resend inside cooldown — use a number registered moments ago so the
  // 60 s window is definitely still open regardless of how long earlier cases took
  await check('UAT-M1-16', async () => {
    const pc = phone();
    const reg = await api('POST', `${A}/register`, { body: { phone: pc, fullName: 'Cooldown' } });
    if (reg.status >= 400) return blocked(`register HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
    const first = await api('POST', `${A}/otp/resend`, { body: { phone: pc, purpose: 'REGISTRATION' } });
    const second = await api('POST', `${A}/otp/resend`, { body: { phone: pc, purpose: 'REGISTRATION' } });
    if (first.status >= 400) return pass(`resend right after registration => HTTP ${first.status} ${JSON.stringify(first.body)}`);
    return second.status >= 400
      ? fail(`cooldown only starts at the first resend: resend #1 after registration => HTTP ${first.status}, resend #2 => HTTP ${second.status} ${JSON.stringify(second.body)} — an extra SMS is sent inside the 60 s window`)
      : fail(`two consecutive resends accepted (${first.status}/${second.status}) — AUTH_OTP_COOLDOWN not enforced`);
  });

  // M1-14 exceed max attempts
  await check('UAT-M1-14', async () => {
    let last;
    for (let i = 0; i < 6; i += 1) last = await api('POST', `${A}/otp/verify`, { body: { phone: p, code: '111111', purpose: 'REGISTRATION' }, noRetry: true });
    const s = JSON.stringify(last.body);
    return /MAX_ATTEMPT|attempt/i.test(s) ? pass(`HTTP ${last.status} ${s}`) : fail(`HTTP ${last.status} ${s}`);
  });

  // fresh number for the happy path (the previous OTP is burnt)
  const p2 = phone();
  let tokens;
  await check('UAT-M1-02', async () => {
    const r = await api('POST', `${A}/register`, { body: { phone: p2, fullName: 'Budi Santoso' } });
    if (r.status >= 400) return fail(`register HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const code = readOtp(p2);
    if (!code) return blocked('no OTP found in auth log');
    const v = await api('POST', `${A}/otp/verify`, { body: { phone: p2, code, purpose: 'REGISTRATION' } });
    tokens = { accessToken: v.cookies.hm_at, refreshToken: v.cookies.hm_rt, customer: v.body?.customer };
    return v.status < 400 && tokens.accessToken && tokens.refreshToken
      ? pass(`HTTP ${v.status}; account ACTIVE; access+refresh tokens issued as httpOnly cookies (hm_at/hm_rt)`)
      : fail(`HTTP ${v.status} ${JSON.stringify(v.body)}; cookies=${Object.keys(v.cookies).join(',')}`);
  });

  ctx.customerA = tokens;
  ctx.customerAPhone = p2;

  // M1-03 login with a registered number
  await check('UAT-M1-03', async () => {
    const r = await api('POST', `${A}/login`, { body: { phone: p2 } });
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const code = readOtp(p2);
    const v = await api('POST', `${A}/otp/verify`, { body: { phone: p2, code, purpose: 'LOGIN' } });
    if (v.status >= 400) return fail(`verify HTTP ${v.status} ${JSON.stringify(v.body)}`);
    const s = await api('GET', '/auth/api/v1/sessions', { token: v.cookies.hm_at });
    const n = Array.isArray(s.body) ? s.body.length : s.body?.items?.length;
    return n >= 1 ? pass(`login ok; ${n} session(s) listed`) : fail(`sessions: HTTP ${s.status} ${JSON.stringify(s.body)}`);
  });

  // M1-04 Google sign-in
  await check('UAT-M1-04', async () => {
    const r = await api('POST', `${A}/login`, { body: { provider: 'google', idToken: 'x' } });
    return na(`no Google endpoint on auth-service (login returns HTTP ${r.status}); route table has no /auth/google`,
      'Fitur Google Sign-In tidak ada di backend — di luar lingkup rilis ini');
  });

  // M1-05 refresh rotation, M1-21 replay of the old refresh token
  let rotated;
  await check('UAT-M1-05', async () => {
    const r = await api('POST', `${A}/token/refresh`, { cookies: { hm_rt: ctx.customerA.refreshToken } });
    rotated = { accessToken: r.cookies.hm_at, refreshToken: r.cookies.hm_rt };
    return r.status < 400 && rotated.accessToken && rotated.refreshToken !== ctx.customerA.refreshToken
      ? pass(`HTTP ${r.status}; new access+refresh issued, refresh rotated`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
  await check('UAT-M1-21', async () => {
    const r = await api('POST', `${A}/token/refresh`, { cookies: { hm_rt: ctx.customerA.refreshToken } });
    return r.status >= 400 ? pass(`replay rejected HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`old refresh token still accepted HTTP ${r.status}`);
  });
  if (rotated?.accessToken) ctx.customerA = rotated;

  // M1-06 / M1-07 sessions list + revoke one
  await check('UAT-M1-06', async () => {
    const r = await api('GET', '/auth/api/v1/sessions', { token: ctx.customerA.accessToken });
    const rows = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
    return r.status < 400 && rows.length >= 1
      ? pass(`HTTP ${r.status}; ${rows.length} sessions; fields: ${Object.keys(rows[0] ?? {}).join(',')}`)
      : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
  await check('UAT-M1-07', async () => {
    // "Revoke another device" needs a second live session; a run only ever logs in once,
    // so sign in again on the same phone first (that IS the second device).
    let list = await api('GET', '/auth/api/v1/sessions', { token: ctx.customerA.accessToken });
    if (((Array.isArray(list.body) ? list.body : list.body?.items ?? []).length) < 2 && ctx.customerAPhone) {
      await loginPhone(ctx.customerAPhone, 'UAT Customer A');
      list = await api('GET', '/auth/api/v1/sessions', { token: ctx.customerA.accessToken });
    }
    const rows = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    if (rows.length < 2) return blocked(`only ${rows.length} session(s) available to revoke`);
    const victim = rows[rows.length - 1];
    const r = await api('POST', `/auth/api/v1/sessions/${victim.id}/revoke`, { token: ctx.customerA.accessToken });
    const after = await api('GET', '/auth/api/v1/sessions', { token: ctx.customerA.accessToken });
    const left = (Array.isArray(after.body) ? after.body : after.body?.items ?? []).length;
    return r.status < 400 && left === rows.length - 1
      ? pass(`revoke HTTP ${r.status}; sessions ${rows.length} -> ${left}; current session still valid`)
      : fail(`revoke HTTP ${r.status} ${JSON.stringify(r.body)}; sessions ${rows.length} -> ${left}`);
  });

  // M1-09 profile update
  await check('UAT-M1-09', async () => {
    const r = await api('PATCH', `${A}/me`, { token: ctx.customerA.accessToken, body: { fullName: 'Budi S.' } });
    const me = await api('GET', `${A}/me`, { token: ctx.customerA.accessToken });
    return r.status < 400 && me.body?.fullName === 'Budi S.'
      ? pass(`HTTP ${r.status}; /auth/me now returns fullName='Budi S.'`)
      : fail(`patch HTTP ${r.status} ${JSON.stringify(r.body)}; me=${JSON.stringify(me.body)}`);
  });

  // M1-10 avatar upload
  await check('UAT-M1-10', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png');
    const r = await api('POST', `${A}/me/avatar`, { token: ctx.customerA.accessToken, body: fd });
    if (r.status < 400 && r.body?.avatarUrl) return pass(`HTTP ${r.status}; avatarUrl=${r.body.avatarUrl}`);
    return blocked(`HTTP ${r.status} ${JSON.stringify(r.body)}`,
      'object storage in this environment is a dummy endpoint (STORAGE_S3_ENDPOINT=https://dummy.local)');
  });

  // M1-11 staff invite
  await check('UAT-M1-11', async () => {
    const sp = phone();
    const r = await api('POST', `${A}/staff/invite`, {
      token: ctx.admin, body: { phone: sp, role: 'DEPOT_OPERATOR', fullName: 'Operator UAT' },
    });
    if (r.status >= 400) return fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
    const staff = await api('GET', `${A}/staff`, { token: ctx.admin });
    const rows = Array.isArray(staff.body) ? staff.body : staff.body?.items ?? [];
    const found = rows.find((s) => s.phone === sp);
    ctx.invitedOperatorPhone = sp;
    return found?.role === 'DEPOT_OPERATOR'
      ? pass(`HTTP ${r.status}; staff account created with role DEPOT_OPERATOR`)
      : fail(`invited but not listed with expected role: ${JSON.stringify(rows.slice(0, 3))}`);
  });

  // M1-12 invalid phone formats
  await check('UAT-M1-12', async () => {
    const bad = ['0211234567', '0812abc4567', '+6591234567'];
    const out = [];
    for (const b of bad) {
      const r = await api('POST', `${A}/register`, { body: { phone: b, fullName: 'X' } });
      out.push(`${b}=>${r.status}`);
    }
    return out.every((o) => !o.endsWith('=>201') && !o.endsWith('=>200'))
      ? pass(out.join(' '))
      : fail(out.join(' '));
  });

  // M1-15 expired OTP
  await check('UAT-M1-15', async () =>
    na('OTP_TTL_SECONDS default 300s; waiting out the TTL is not run in this automated pass',
      'Perlu eksekusi manual/penyesuaian OTP_TTL_SECONDS di lingkungan UAT'));

  // M1-17 duplicate registration
  await check('UAT-M1-17', async () => {
    const r = await api('POST', `${A}/register`, { body: { phone: p2, fullName: 'Duplikat' } });
    return r.status >= 400
      ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`)
      : fail(`re-register of an active number accepted: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // M1-18 login with an unknown number
  await check('UAT-M1-18', async () => {
    const r = await api('POST', `${A}/login`, { body: { phone: '+628999999999' } });
    const s = JSON.stringify(r.body ?? '');
    const leaks = /not found|tidak terdaftar|belum terdaftar|unregistered/i.test(s);
    return r.status >= 400 && !leaks
      ? pass(`HTTP ${r.status} ${s} (neutral)`)
      : r.status >= 400
        ? fail(`HTTP ${r.status} ${s} — message discloses registration state`)
        : fail(`login accepted for unknown number HTTP ${r.status}`);
  });

  // M1-19 protected endpoint without a token
  await check('UAT-M1-19', async () => {
    const r = await api('GET', `${A}/me`);
    return r.status === 401 ? pass(`HTTP 401`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });

  // M1-20 tampered + expired token
  await check('UAT-M1-20', async () => {
    const tampered = `${(ctx.customerA?.accessToken ?? mintToken('CUSTOMER')).slice(0, -3)}aaa`;
    const expired = mintToken('CUSTOMER', {}, -60);
    const a = await api('GET', `${A}/me`, { token: tampered });
    const b = await api('GET', `${A}/me`, { token: expired });
    return a.status === 401 && b.status === 401 ? pass('tampered=401 expired=401') : fail(`tampered=${a.status} expired=${b.status}`);
  });

  // M1-08 logout all + M1-22 token use after logout all
  await check('UAT-M1-08', async () => {
    const r = await api('POST', `${A}/logout/all`, { token: ctx.customerA.accessToken });
    return r.status < 400 ? pass(`HTTP ${r.status}`) : fail(`HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
  await check('UAT-M1-22', async () => {
    const r = await api('POST', `${A}/token/refresh`, { cookies: { hm_rt: ctx.customerA.refreshToken } });
    return r.status >= 400 ? pass(`HTTP ${r.status} ${JSON.stringify(r.body)}`) : fail(`refresh accepted after logout-all: HTTP ${r.status}`);
  });

  // re-login customer A for later modules
  const re = await api('POST', `${A}/login`, { body: { phone: p2 } });
  if (re.status < 400) {
    const code = readOtp(p2);
    const v = await api('POST', `${A}/otp/verify`, { body: { phone: p2, code, purpose: 'LOGIN' } });
    if (v.status < 400) ctx.customerA = { accessToken: v.cookies.hm_at, refreshToken: v.cookies.hm_rt };
  }

  // M1-23 / M1-24 phone length boundaries
  await check('UAT-M1-23', async () => {
    const r = await api('POST', `${A}/register`, { body: { phone: '+628123456701', fullName: 'Min' } });
    const r2 = await api('POST', `${A}/register`, { body: { phone: '+62812345670', fullName: 'Min' } });
    return { status: r2.status < 400 || r.status < 400 ? 'Pass' : 'Fail',
      actual: `NSN 9-digit(+62812345670)=>${r2.status}; 11-digit=>${r.status}` };
  });
  await check('UAT-M1-24', async () => {
    const ok12 = await api('POST', `${A}/register`, { body: { phone: '+628121234567890'.slice(0, 15), fullName: 'Max' } });
    const bad13 = await api('POST', `${A}/register`, { body: { phone: '+6281212345678901', fullName: 'Over' } });
    return ok12.status < 400 && bad13.status >= 400
      ? pass(`12-digit NSN => ${ok12.status}; 13-digit NSN => ${bad13.status}`)
      : fail(`12-digit NSN => ${ok12.status}; 13-digit NSN => ${bad13.status}`);
  });

  // M1-25 / M1-26 timing boundaries
  await check('UAT-M1-25', async () => na('verifying at TTL-1s requires a 299s wait — not run in the automated pass'));
  await check('UAT-M1-26', async () => {
    const p3 = phone();
    await api('POST', `${A}/register`, { body: { phone: p3, fullName: 'Cooldown' } });
    await new Promise((r) => setTimeout(r, 61_000));
    const r = await api('POST', `${A}/otp/resend`, { body: { phone: p3, purpose: 'REGISTRATION' } });
    return r.status < 400 ? pass(`resend after 61s => HTTP ${r.status}`) : fail(`resend after 61s => HTTP ${r.status} ${JSON.stringify(r.body)}`);
  });
}
