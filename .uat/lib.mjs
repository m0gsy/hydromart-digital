// UAT harness core: HTTP against the running gateway, role tokens, OTP capture,
// and result recording. Every check returns Pass/Fail/Blocked/N-A + evidence.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
export const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? 'hydromart-shared-dev-access-secret-please-change-01';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Mint an HS256 token exactly like auth-service signs it. */
export function mintToken(role, claims = {}, ttl = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { sub: claims.sub ?? crypto.randomUUID(), role, phone: claims.phone ?? '+620000000000', iat: now, exp: now + ttl, ...claims };
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * The gateway rate-limits to RATE_LIMIT_MAX requests/minute per IP. A scripted UAT
 * sweep trips that constantly, so absorb 429s here — except where the test *is* the
 * rate limit (pass `noRetry`).
 */
// Gateway allows RATE_LIMIT_MAX (default 100) requests per minute per IP. Pace the
// sweep just under that instead of hammering and back-filling with retries.
let nextSlot = 0;
const PACE_MS = Number(process.env.UAT_PACE_MS ?? 620);
async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + PACE_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function api(method, path, opts = {}) {
  if (!opts.noRetry) await pace();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await rawApi(method, path, opts);
    if (r.status !== 429 || opts.noRetry) return r;
    await new Promise((res) => setTimeout(res, 5_000));
  }
  return rawApi(method, path, opts);
}

async function rawApi(method, path, { body, token, headers = {}, base = GATEWAY, raw = false, cookies } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  if (cookies) h.cookie = Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  let res, text;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    text = await res.text();
  } catch (e) {
    return { status: 0, body: { error: String(e.message ?? e) }, text: '' };
  }
  if (raw) return { status: res.status, text, headers: res.headers, cookies: parseCookies(res) };
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json, text, headers: res.headers, cookies: parseCookies(res) };
}

/** Auth issues tokens as httpOnly cookies (hm_at / hm_rt), not in the JSON body. */
function parseCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return Object.fromEntries(raw.map((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    return [pair.slice(0, i).trim(), pair.slice(i + 1)];
  }));
}

const DC = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml'];
process.env.PATH = `${process.env.PATH};C:\\Program Files\\Docker\\Docker\\resources\\bin`;

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Newest dev OTP for a phone, read from the auth container log. */
export function readOtp(phone) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = spawnSync('docker', [...DC, 'logs', '--tail', '300', 'auth'], {
      cwd: 'g:/VsCode/Hydromart', encoding: 'utf8', shell: true, maxBuffer: 20e6,
    });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    const line = text.split('\n').filter((l) => l.includes('[DEV OTP]') && l.includes(phone)).at(-1);
    if (line) return line.match(/:\s*(\d{4,8})\s*\(/)?.[1] ?? null;
    sleepSync(300);
  }
  return null;
}

export function dc(...args) {
  const r = spawnSync('docker', [...DC, ...args], { cwd: 'g:/VsCode/Hydromart', encoding: 'utf8', shell: true, maxBuffer: 20e6 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

/** Register (or log in) a customer through the real OTP flow. */
export async function loginPhone(phone, fullName) {
  let purpose = 'LOGIN';
  let r = await api('POST', '/auth/api/v1/auth/login', { body: { phone } });
  if (r.status >= 400) {
    purpose = 'REGISTRATION';
    r = await api('POST', '/auth/api/v1/auth/register', { body: { phone, fullName: fullName ?? 'UAT User' } });
  }
  if (r.status >= 400) return { ok: false, detail: r };
  const code = readOtp(phone);
  if (!code) return { ok: false, detail: { note: 'no OTP in auth log', send: r } };
  const v = await api('POST', '/auth/api/v1/auth/otp/verify', { body: { phone, code, purpose } });
  if (v.status >= 400) return { ok: false, detail: v };
  return {
    ok: true,
    ...v.body,
    accessToken: v.cookies.hm_at,
    refreshToken: v.cookies.hm_rt,
    customerId: v.body?.customer?.id,
  };
}

// ---------------------------------------------------------------- results
export const results = [];
export const evidenceOf = (x) => {
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

export function record(id, status, actual, note = '') {
  results.push({ id, status, actual: evidenceOf(actual), note });
  const mark = { Pass: 'PASS', Fail: 'FAIL', Blocked: 'BLCK', 'N/A': 'N/A ', 'Not Run': '----' }[status] ?? status;
  console.log(`${mark} ${id} ${String(actual).slice(0, 140).replace(/\s+/g, ' ')}`);
}

/** Run one case; any thrown error becomes a Blocked with the message as evidence. */
export async function check(id, fn) {
  try {
    const r = await fn();
    if (!r) return record(id, 'Blocked', 'check returned nothing');
    record(id, r.status, r.actual, r.note ?? '');
  } catch (e) {
    record(id, 'Blocked', `harness error: ${e.message}`);
  }
}

export const pass = (actual, note) => ({ status: 'Pass', actual, note });
export const fail = (actual, note) => ({ status: 'Fail', actual, note });
export const blocked = (actual, note) => ({ status: 'Blocked', actual, note });
export const na = (actual, note) => ({ status: 'N/A', actual, note });

export function save(file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 1));
  const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  console.log(`\n== ${results.length} cases: ${JSON.stringify(tally)}`);
}

export const uniq = () => crypto.randomUUID().slice(0, 8);
export const phone = () => `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/**
 * Calls a service-to-service endpoint from INSIDE the compose network.
 *
 * The gateway deliberately deletes x-internal-key on every inbound request (SEC-4) so a
 * browser can never inject it and escalate to the system principal — which also means
 * these endpoints are unreachable from the host through :8080 by design. The scheduler
 * container reaches them directly over the compose network, and so do we, by running the
 * fetch inside a service container.
 */
export async function internalApi(container, port, path, { method = 'POST', body } = {}) {
  const { execFile } = await import('node:child_process');
  // Wrapped in an async IIFE: `node -e` evaluates as CommonJS, where top-level await is
  // a syntax error.
  const script = `(async () => {
    const r = await fetch('http://localhost:${port}${path}', {
      method: '${method}',
      headers: { 'content-type': 'application/json', 'x-internal-key': process.env.INTERNAL_SERVICE_KEY ?? '' },
      ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    console.log(JSON.stringify({ status: r.status, body: await r.text() }));
  })().catch((e) => console.log(JSON.stringify({ status: 0, body: String(e).slice(0, 200) })));`;
  return new Promise((resolve) => {
    execFile('docker', ['exec', container, 'node', '-e', script], { timeout: 30_000 }, (err, stdout) => {
      if (err && !stdout) return resolve({ status: 0, body: { error: String(err).slice(0, 200) } });
      try {
        const parts = stdout.trim().split(String.fromCharCode(10));
        const out = JSON.parse(parts[parts.length - 1].trim());
        let parsed = out.body;
        try { parsed = JSON.parse(out.body); } catch { /* plain text body */ }
        resolve({ status: out.status, body: parsed });
      } catch {
        resolve({ status: 0, body: { error: stdout.slice(0, 200) } });
      }
    });
  });
}
