#!/usr/bin/env node
/**
 * Customer access tokens for the k6 scripts next door, minted the only way this system
 * allows: register, read the dev OTP out of the auth container's log, verify, keep the
 * `hm_at` cookie. Both load scripts want ONE TOKEN PER VU — checkout consumes a
 * server-side cart, so sharing a token means VUs contending on the same cart and a
 * number that measures contention rather than the fan-out under test.
 *
 *   node scripts/load/mint-tokens.mjs 10        # prints a comma-separated TOKENS value
 *
 * Reads the OTP from the compose logs, exactly like test/integration/flow.mjs, so it only
 * works against a stack booted from docker-compose.test.yml — which is the stack the load
 * workflow boots. It is deliberately incapable of running against production.
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const COUNT = Number(process.argv[2] ?? 10);
const win = process.platform === 'win32';
const COMPOSE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, cookies: res.headers.getSetCookie?.() ?? [] };
}

async function readOtp(phone) {
  const re = new RegExp(`REGISTRATION code for \\${phone}:\\s*(\\d{4,8})`, 'g');
  for (let i = 0; i < 15; i++) {
    const r = spawnSync('docker', ['compose', ...COMPOSE, 'logs', '--no-log-prefix', 'auth'], {
      encoding: 'utf8',
      shell: win,
    });
    const hits = [...((r.stdout || '') + (r.stderr || '')).matchAll(re)];
    if (hits.length) return hits[hits.length - 1][1];
    await sleep(1000);
  }
  throw new Error(`OTP for ${phone} not found in auth logs`);
}

const cookieValue = (cookies, name) =>
  cookies.map((c) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(c)?.[1]).find(Boolean) ?? null;

/*
 * The dashboard script needs a STAFF token, and there is no staff registration flow —
 * staff are invited. It is signed here from the stack's own secret, exactly the way
 * flow.mjs and the f6 harnesses do, rather than inventing a back door in auth-service.
 */
if (process.argv.includes('--staff')) {
  const secret = process.env.JWT_ACCESS_SECRET ?? 'itest-shared-access-secret-0123456789abcdef';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: randomUUID(),
    phone: '+620000000000',
    role: 'SUPER_ADMIN',
    iat: now,
    exp: now + 3600,
  })}`;
  process.stdout.write(`${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`);
  process.exit(0);
}

const stamp = Date.now().toString().slice(-8);
const tokens = [];
for (let i = 0; i < COUNT; i++) {
  const phone = `08${stamp}${String(i).padStart(2, '0')}`;
  const reg = await api('POST', '/auth/api/v1/auth/register', { phone, fullName: `Load VU ${i}` });
  if (reg.status >= 400) throw new Error(`register ${phone}: HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
  const code = await readOtp(phone);
  const verify = await api('POST', '/auth/api/v1/auth/otp/verify', { phone, code, purpose: 'REGISTRATION' });
  const token = cookieValue(verify.cookies, 'hm_at');
  if (!token) throw new Error(`no hm_at cookie for ${phone}: ${JSON.stringify(verify.body)}`);
  tokens.push(token);
  console.error(`minted ${i + 1}/${COUNT}`);
}
// stdout is the value, stderr is the progress — so `TOKENS=$(node … 10)` just works.
process.stdout.write(tokens.join(','));
