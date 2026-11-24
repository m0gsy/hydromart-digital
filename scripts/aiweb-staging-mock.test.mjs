// Self-test of the staging AI web's fake hydromart (infra/aiweb-staging/mock/server.mjs):
// the sign-in end to end the way the AI web does it (PKCE, one-time code, token checked with
// the published key), the authenticator step, the kill switch, n8n's machine account and
// notification, and every route and shape held against contracts/ai-v1/*.openapi.json.
//
//   node scripts/aiweb-staging-mock.test.mjs
import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PATTERNS, RECOVERY_CODE, TOTP_CODE, createMock, signEvent } from '../infra/aiweb-staging/mock/server.mjs';

const contract = (name) => JSON.parse(readFileSync(new URL(`../contracts/ai-v1/${name}.openapi.json`, import.meta.url), 'utf8'));
const auth = contract('auth');
const notifications = contract('notifications');
const events = contract('events');
const fixtures = JSON.parse(readFileSync(new URL('../infra/aiweb-staging/mock/fixtures.json', import.meta.url), 'utf8'));

const AI_WEB = 'https://staging-ai.example.test';
const MACHINE = { id: randomUUID(), secret: randomBytes(32).toString('hex') };

async function boot(extra = {}, now) {
  const mock = createMock({ env: { MOCK_AI_WEB_URL: AI_WEB, MOCK_MACHINE_ID: MACHINE.id, MOCK_MACHINE_SECRET: MACHINE.secret, ...extra }, ...(now && { now }) });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.server.address().port}`;
  const close = () => new Promise((r) => mock.server.close(r));
  return { ...mock, base, close };
}
const json = (method, base, path, body, headers = {}) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body), redirect: 'manual' });

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url') };
}
/** The picker's POST: what a click on a person does. Returns the callback URL's code. */
async function pick(mock, user, p, headers = {}) {
  const form = new URLSearchParams({ user: user.id, challenge: p.challenge, state: p.state, return: `${AI_WEB}/masuk/callback` });
  const res = await fetch(`${mock.base}/ai/masuk`, { method: 'POST', body: form, redirect: 'manual', headers });
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get('location'));
  assert.equal(`${to.origin}${to.pathname}`, `${AI_WEB}/masuk/callback`);
  assert.equal(to.searchParams.get('state'), p.state);
  return { code: to.searchParams.get('code'), res };
}
const user = (role, extra = {}) => fixtures.users.find((u) => u.role === role && Object.entries(extra).every(([k, v]) => u[k] === v) && (extra.enrolmentRequired || !u.enrolmentRequired) && (extra.suspended || !u.suspended));

async function jwks(mock) {
  const body = await (await fetch(`${mock.base}/auth/api/v1/auth/jwks`)).json();
  return body.keys;
}
/** Checked the way the AI web's token.ts does it. */
function verifyToken(token, keys) {
  const [h, b, s] = token.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  assert.equal(head.alg, 'ES256');
  const jwk = keys.find((k) => k.kid === head.kid);
  assert.ok(jwk, 'the token names a published key');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  const sig = Buffer.from(s, 'base64url');
  assert.equal(sig.length, 64);
  assert.ok(verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, sig), 'signature');
  return JSON.parse(Buffer.from(b, 'base64url').toString());
}

test('the contracts: routes, patterns and shapes the mock serves', async () => {
  for (const path of ['/auth/api/v1/auth/jwks', '/auth/api/v1/auth/handoff/token', '/auth/api/v1/auth/machine/token']) {
    assert.ok(auth.paths[path], `${path} is in auth.openapi.json`);
  }
  assert.ok(notifications.paths['/crm/api/v1/notifications/external/franchise-application-submitted']);
  const handoff = auth.paths['/auth/api/v1/auth/handoff/token'].post.requestBody.content['application/json'].schema.properties;
  assert.equal(PATTERNS.code, handoff.code.pattern);
  assert.equal(PATTERNS.codeVerifier, handoff.codeVerifier.pattern);
  assert.equal(PATTERNS.totp, handoff.totp.pattern);
  assert.equal(PATTERNS.recoveryCode, handoff.recoveryCode.pattern);
  const notify = notifications.components.schemas.FranchiseApplicationSubmittedNotify.properties;
  assert.equal(PATTERNS.eventId, notify.eventId.pattern);
  assert.equal(PATTERNS.place, notify.city.pattern);
  assert.equal(PATTERNS.place, notify.province.pattern);
  assert.match(TOTP_CODE, new RegExp(PATTERNS.totp));
  assert.match(RECOVERY_CODE, new RegExp(PATTERNS.recoveryCode));

  const mock = await boot();
  try {
    // JWKS: every required field, only the constants the contract names.
    const keys = await jwks(mock);
    assert.equal(keys.length, 1);
    const need = auth.components.schemas.Jwks.properties.keys.items;
    for (const f of need.required) assert.ok(keys[0][f], `jwks key has ${f}`);
    assert.equal(keys[0].kty, need.properties.kty.const);
    assert.equal(keys[0].crv, need.properties.crv.const);
    assert.equal(keys[0].use, need.properties.use.const);
    assert.equal(keys[0].alg, need.properties.alg.const);

    // Token (200 of handoff and of machine): required fields and constants.
    const T = auth.components.schemas.Token;
    const p = pkce();
    const { code } = await pick(mock, user('SUPERVISOR'), p);
    const ok = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier })).json();
    for (const f of T.required) assert.ok(ok[f] !== undefined, `token has ${f}`);
    assert.equal(ok.tokenType, T.properties.tokenType.const);
    assert.equal(ok.expiresIn, T.properties.expiresIn.const);
    const m = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    for (const f of T.required) assert.ok(m[f] !== undefined, `machine token has ${f}`);
    assert.equal(m.expiresIn, T.properties.expiresIn.const);

    // Every status the mock answers on handoff is one the contract documents.
    const documented = new Set(Object.keys(auth.paths['/auth/api/v1/auth/handoff/token'].post.responses));
    for (const s of [200, 401, 403, 422, 429, 503]) assert.ok(documented.has(String(s)), `handoff documents ${s}`);
    // 400 is the framework's validation answer, not listed; the mock answers it for a bad body.
    const bad = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code: 'x', codeVerifier: 'y' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'VALIDATION_ERROR');
  } finally {
    await mock.close();
  }
});

test('sign-in end to end, and the code is single use', async () => {
  const mock = await boot();
  try {
    const p = pkce();
    const person = user('MANAGER');
    const { code } = await pick(mock, person, p);
    assert.match(code, new RegExp(PATTERNS.code));
    const res = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier });
    assert.equal(res.status, 200);
    const claims = verifyToken((await res.json()).accessToken, await jwks(mock));
    assert.equal(claims.iss, 'hydromart-auth');
    assert.equal(claims.aud, 'hydromart-ai');
    assert.equal(claims.sub, person.id);
    assert.equal(claims.role, 'MANAGER');
    assert.equal(claims.depotId, person.depotId);
    assert.ok(claims.exp > Date.now() / 1000 && claims.exp - claims.nbf === 900);
    // Spent at first use.
    const again = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier });
    assert.equal(again.status, 401);
    assert.equal((await again.json()).code, 'AUTH_HANDOFF_INVALID');
  } finally {
    await mock.close();
  }
});

test('a wrong verifier spends the code; an unknown return address is refused', async () => {
  const mock = await boot();
  try {
    const p = pkce();
    const { code } = await pick(mock, user('HR'), p);
    const wrong = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: pkce().verifier });
    assert.equal(wrong.status, 401);
    const right = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier });
    assert.equal(right.status, 401, 'spent, right verifier or wrong');

    const q = new URLSearchParams({ challenge: p.challenge, state: p.state, return: 'https://evil.example/masuk/callback' });
    assert.equal((await fetch(`${mock.base}/ai/masuk?${q}`)).status, 400);
    q.set('return', `${AI_WEB}/masuk/callback`);
    q.set('state', 'short');
    assert.equal((await fetch(`${mock.base}/ai/masuk?${q}`)).status, 400);
  } finally {
    await mock.close();
  }
});

test('the picker lists one person per role and continues without a click for the same person', async () => {
  const mock = await boot();
  try {
    const p = pkce();
    const q = new URLSearchParams({ challenge: p.challenge, state: p.state, return: `${AI_WEB}/masuk/callback` });
    const html = await (await fetch(`${mock.base}/ai/masuk?${q}`)).text();
    for (const role of ['STAFF_DEPOT', 'KEPALA_DEPOT', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'MANAGER', 'DIREKTUR', 'FRANCHISE_OWNER', 'HEAD_OFFICE', 'FINANCE', 'HR', 'MARKETING', 'SUPER_ADMIN', 'CUSTOMER']) {
      assert.ok(html.includes(`<small>${role}</small>`), `picker has ${role}`);
    }
    assert.ok(html.includes(TOTP_CODE));
    const { res } = await pick(mock, user('MARKETING'), p);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const next = pkce();
    const q2 = new URLSearchParams({ challenge: next.challenge, state: next.state, return: `${AI_WEB}/masuk/callback` });
    const quiet = await fetch(`${mock.base}/ai/masuk?${q2}`, { redirect: 'manual', headers: { cookie, referer: `${AI_WEB}/masuk` } });
    assert.equal(quiet.status, 303, 'the AI web sent the same person again: no click');
    q2.set('pick', '1');
    const shown = await fetch(`${mock.base}/ai/masuk?${q2}`, { redirect: 'manual', headers: { cookie, referer: `${AI_WEB}/masuk` } });
    assert.equal(shown.status, 200);
  } finally {
    await mock.close();
  }
});

test('the authenticator step: required, kept once, wrong code, ticket, recovery, lockout', async () => {
  const mock = await boot();
  const handoff = (body) => json('POST', mock.base, '/auth/api/v1/auth/handoff/token', body);
  try {
    const person = user('DIREKTUR');
    let p = pkce();
    let { code } = await pick(mock, person, p);
    let r = await handoff({ code, codeVerifier: p.verifier });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).code, 'AUTH_TOTP_REQUIRED');
    // The same code and verifier again, now with the authenticator's code.
    r = await handoff({ code, codeVerifier: p.verifier, totp: TOTP_CODE });
    assert.equal(r.status, 200);
    const ok = await r.json();
    assert.match(ok.secondFactorTicket, /^[0-9]+[.][A-Za-z0-9_-]+$/);
    assert.equal(ok.secondFactorTicketExpiresIn, 43200);

    // With the ticket the next sign-in needs no code.
    p = pkce();
    ({ code } = await pick(mock, person, p));
    r = await handoff({ code, codeVerifier: p.verifier, secondFactorTicket: ok.secondFactorTicket });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).secondFactorTicket, undefined);
    // A ticket is the person's own.
    p = pkce();
    ({ code } = await pick(mock, user('FINANCE'), p));
    r = await handoff({ code, codeVerifier: p.verifier, secondFactorTicket: ok.secondFactorTicket });
    assert.equal((await r.json()).code, 'AUTH_TOTP_REQUIRED');

    // The recovery code works too.
    p = pkce();
    ({ code } = await pick(mock, user('HEAD_OFFICE'), p));
    r = await handoff({ code, codeVerifier: p.verifier, recoveryCode: RECOVERY_CODE });
    assert.equal(r.status, 200);

    // Five wrong codes lock the person.
    const target = user('SUPER_ADMIN');
    for (let i = 0; i < 5; i += 1) {
      p = pkce();
      ({ code } = await pick(mock, target, p));
      r = await handoff({ code, codeVerifier: p.verifier, totp: '000000' });
      assert.equal(r.status, 422);
      assert.equal((await r.json()).code, 'AUTH_TOTP_INVALID');
    }
    p = pkce();
    ({ code } = await pick(mock, target, p));
    r = await handoff({ code, codeVerifier: p.verifier, totp: TOTP_CODE });
    assert.equal(r.status, 429);
    const locked = await r.json();
    assert.equal(locked.code, 'AUTH_TOTP_LOCKED');
    assert.ok(locked.details.retryAfterSeconds > 0);
  } finally {
    await mock.close();
  }
});

test('the failure fixtures answer with the codes the AI web maps', async () => {
  const mock = await boot();
  try {
    const cases = [
      [user('CUSTOMER'), 403, 'AUTH_HANDOFF_STAFF_ONLY'],
      [user('STAFF_DEPOT', { suspended: true }), 403, 'AUTH_ACCOUNT_SUSPENDED'],
      [user('FINANCE', { enrolmentRequired: true }), 403, 'AUTH_TOTP_ENROLMENT_REQUIRED'],
    ];
    for (const [person, status, code] of cases) {
      const p = pkce();
      const c = (await pick(mock, person, p)).code;
      const r = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code: c, codeVerifier: p.verifier });
      assert.equal(r.status, status);
      assert.equal((await r.json()).code, code);
    }
  } finally {
    await mock.close();
  }
});

test('the kill switch empties the key set and turns tokens off, and back', async () => {
  const mock = await boot();
  try {
    assert.equal((await jwks(mock)).length, 1);
    assert.equal((await fetch(`${mock.base}/_mock/kill`, { method: 'POST', redirect: 'manual' })).status, 303);
    assert.deepEqual(await jwks(mock), []);
    const p = pkce();
    const { code } = await pick(mock, user('MANAGER'), p);
    const r = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'AUTH_EXTERNAL_TOKENS_OFF');
    assert.equal((await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).status, 503);
    await fetch(`${mock.base}/_mock/kill`, { method: 'POST', redirect: 'manual' });
    assert.equal((await jwks(mock)).length, 1);
  } finally {
    await mock.close();
  }
});

test('n8n: machine token, then the franchise notification, idempotent, validated, failing on GAGAL', async () => {
  const mock = await boot();
  const note = (token, body, extra = {}) =>
    json('POST', mock.base, '/crm/api/v1/notifications/external/franchise-application-submitted', body, { authorization: `Bearer ${token}`, 'x-workflow': 'wf', ...extra });
  try {
    assert.equal((await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: 'x'.repeat(64) })).status, 401);
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const claims = verifyToken(accessToken, await jwks(mock));
    assert.equal(claims.aud, 'hydromart-machine');
    assert.deepEqual(claims.scopes, ['franchiseApplicationNotify', 'morningSummaryNotify']);

    const applicationId = randomUUID();
    const body = { eventId: `franchise.application_submitted:${applicationId}`, applicationId, city: 'Bekasi', province: 'Jawa Barat' };
    const first = await note(accessToken, body);
    assert.equal(first.status, 200);
    const { id } = await first.json();
    assert.match(id, /^[0-9a-f-]{36}$/);
    const replay = await note(accessToken, { ...body, eventId: body.eventId.toUpperCase().replace('FRANCHISE.APPLICATION_SUBMITTED', 'franchise.application_submitted') });
    assert.equal((await replay.json()).id, id, 'same eventId, same notification');
    assert.equal(mock.state.calls.notifications.length, 1);

    assert.equal((await note(accessToken, { ...body, extra: 1 })).status, 400);
    assert.equal((await note(accessToken, { ...body, applicationId: randomUUID() })).status, 400);
    assert.equal((await note(accessToken, { ...body, city: '12345' })).status, 400);
    const other = randomUUID();
    assert.equal((await note(accessToken, { eventId: `franchise.application_submitted:${other}`, applicationId: other, city: 'GAGAL', province: 'Jawa Barat' })).status, 500);
    // A person's token is not a machine's, and nothing at all is not a token.
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    assert.equal((await note(human.accessToken, body)).status, 401);
    assert.equal((await note('nope', body)).status, 401);
  } finally {
    await mock.close();
  }
});

test('n8n: the morning summary needs the machine scope and the Jakarta date of today', async () => {
  const mock = await boot();
  const send = (token, body) =>
    json('POST', mock.base, '/crm/api/v1/notifications/external/morning-summary', body, token ? { authorization: `Bearer ${token}` } : {});
  try {
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const ok = await send(accessToken, { eventId: `morning-summary:${date}`, date });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { date, recipients: 0, notified: 0, nothingWaiting: 0, whatsapp: 'pending' });
    assert.equal((await send(accessToken, { eventId: 'morning-summary:2020-01-01', date: '2020-01-01' })).status, 400);
    assert.equal((await send(accessToken, { eventId: `morning-summary:${date}`, date: '2020-01-01' })).status, 400);
    assert.equal((await send(accessToken, { eventId: `morning-summary:${date}`, date, extra: 1 })).status, 400);
    assert.equal((await send(accessToken, { eventId: `morning-summary:${date}` })).status, 400);
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    assert.equal((await send(human.accessToken, { eventId: `morning-summary:${date}`, date })).status, 401);
    assert.equal((await send('nope', { eventId: `morning-summary:${date}`, date })).status, 401);
    assert.equal((await send(null, { eventId: `morning-summary:${date}`, date })).status, 401);
  } finally {
    await mock.close();
  }
});

test('the morning summary day is Jakarta’s, not UTC’s: 17:30Z on 24 Nov is 25 Nov', async () => {
  const mock = await boot({}, () => Date.parse('2026-11-24T17:30:00Z'));
  const send = (token, date) =>
    json('POST', mock.base, '/crm/api/v1/notifications/external/morning-summary', { eventId: `morning-summary:${date}`, date }, { authorization: `Bearer ${token}` });
  try {
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    assert.equal((await send(accessToken, '2026-11-25')).status, 200);
    assert.equal((await send(accessToken, '2026-11-24')).status, 400);
  } finally {
    await mock.close();
  }
});

test('the alarm webhook, the console, the reset and the health check', async () => {
  const mock = await boot();
  try {
    assert.equal((await json('POST', mock.base, '/alert', { text: 'x' })).status, 204);
    assert.equal(mock.state.calls.alerts.length, 1);
    assert.equal((await fetch(`${mock.base}/health`)).status, 200);
    const page = await (await fetch(`${mock.base}/_mock/`)).text();
    assert.ok(page.includes('/_mock/event') && page.includes('/_mock/kill'));
    await fetch(`${mock.base}/_mock/reset`, { method: 'POST', redirect: 'manual' });
    assert.equal(mock.state.calls.alerts.length, 0);
    assert.equal((await fetch(`${mock.base}/nowhere`)).status, 404);
  } finally {
    await mock.close();
  }
});

test('the event button signs the way hydromart does and posts it to the AI web', async () => {
  const seen = [];
  const { createServer } = await import('node:http');
  const ingress = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, raw });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => ingress.listen(0, '127.0.0.1', r));
  const secret = randomBytes(32).toString('hex');
  const mock = await boot({ MOCK_HD_EVENT_SECRET: secret, MOCK_INGRESS_URL: `http://127.0.0.1:${ingress.address().port}/api/ingress/hd` });
  try {
    await fetch(`${mock.base}/_mock/event`, { method: 'POST', body: new URLSearchParams({ city: 'Depok' }), redirect: 'manual' });
    assert.equal(seen.length, 1);
    const { headers, raw } = seen[0];
    const { createHmac } = await import('node:crypto');
    const expect = 'sha256=' + createHmac('sha256', secret).update(`${headers['x-hydromart-timestamp']}.${raw}`).digest('hex');
    assert.equal(headers['x-hydromart-signature'], expect);
    const event = JSON.parse(raw);
    assert.equal(headers['x-hydromart-event'], 'franchise.application_submitted');
    assert.match(event.eventId, new RegExp(PATTERNS.eventId));
    assert.equal(event.data.city, 'Depok');
    assert.equal(mock.state.lastEvent.status, 204);
  } finally {
    await mock.close();
    await new Promise((r) => ingress.close(r));
  }
});

test('a key from the environment survives a restart, and no secret is in the repository files', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const a = createMock({ env: { MOCK_SIGNING_KEY: key } });
  const b = createMock({ env: { MOCK_SIGNING_KEY: key } });
  assert.equal(a.jwk.kid, b.jwk.kid);
  assert.notEqual(createMock({}).jwk.kid, a.jwk.kid, 'without a key a fresh one is made');
  for (const f of ['server.mjs', 'fixtures.json']) {
    const text = readFileSync(new URL(`../infra/aiweb-staging/mock/${f}`, import.meta.url), 'utf8');
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(text), `${f} holds no private key`);
    assert.ok(!/investor/i.test(text), `${f}: say calon mitra`);
  }
});

test('the event signature matches the contract test vector', () => {
  const v = events.info['x-hydromart-signature-test-vector'] ?? events['x-hydromart-signature-test-vector'];
  assert.ok(v, 'events.openapi.json carries the vector');
  assert.equal(signEvent(v.secret, v.timestamp, v.body), v.signature);
});

test('the console refuses cross-site posts, changes nothing on GET, and cannot be framed', async () => {
  const mock = await boot();
  const post = (path, headers) => fetch(`${mock.base}${path}`, { method: 'POST', redirect: 'manual', headers });
  try {
    for (const path of ['/_mock/kill', '/_mock/reset', '/_mock/event']) {
      assert.equal((await post(path, { 'sec-fetch-site': 'cross-site' })).status, 403, `${path} cross-site`);
      assert.equal((await post(path, { 'sec-fetch-site': 'same-site' })).status, 403, `${path} same-site`);
      assert.equal((await post(path, { origin: 'https://evil.example' })).status, 403, `${path} other origin`);
      assert.equal((await post(path, { origin: 'null' })).status, 403, `${path} null origin`);
    }
    assert.equal(mock.state.killed, false);
    // A same-origin browser post and a plain client both work.
    const host = new URL(mock.base).host;
    assert.equal((await post('/_mock/kill', { 'sec-fetch-site': 'same-origin', origin: `http://${host}` })).status, 303);
    assert.equal(mock.state.killed, true);
    assert.equal((await post('/_mock/kill', {})).status, 303);
    assert.equal(mock.state.killed, false);
    // The picker's post is guarded the same way.
    assert.equal((await post('/ai/masuk', { 'sec-fetch-site': 'cross-site' })).status, 403);
    // No GET changes state.
    for (const path of ['/_mock/kill', '/_mock/reset', '/_mock/event']) {
      assert.equal((await fetch(`${mock.base}${path}`)).status, 404);
    }
    assert.equal(mock.state.killed, false);
    const page = await fetch(`${mock.base}/_mock/`);
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'none'");
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
  } finally {
    await mock.close();
  }
});

test('logs and maps stay bounded, and an oversize body is answered', async () => {
  const mock = await boot();
  try {
    for (let i = 0; i < 260; i += 1) await json('POST', mock.base, '/alert', { text: 'x'.repeat(50_000) });
    assert.equal(mock.state.calls.alerts.length, 200);
    assert.ok(JSON.stringify(mock.state.calls.alerts[0]).length < 200, 'a summary, not the body');

    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const note = () => {
      const id = randomUUID();
      return json('POST', mock.base, '/crm/api/v1/notifications/external/franchise-application-submitted',
        { eventId: `franchise.application_submitted:${id}`, applicationId: id, city: 'Bekasi', province: 'Jawa Barat' }, { authorization: `Bearer ${accessToken}` });
    };
    for (let i = 0; i < 10_100; i += 100) await Promise.all(Array.from({ length: 100 }, note));
    assert.equal(mock.state.calls.notifications.length, 200);
    assert.equal(mock.state.notified.size, 10_000);

    const big = await fetch(`${mock.base}/alert`, { method: 'POST', body: 'x'.repeat(70_000) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${mock.base}/health`)).status, 200, 'still serving');
    assert.equal(mock.server.requestTimeout, 15_000);
    assert.ok(mock.server.headersTimeout <= 15_000);
  } finally {
    await mock.close();
  }
});
