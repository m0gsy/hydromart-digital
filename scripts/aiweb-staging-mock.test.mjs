// Self-test of the staging AI web's fake hydromart (infra/aiweb-staging/mock/server.mjs):
// the sign-in end to end the way the AI web does it (PKCE, one-time code, token checked with
// the published key), the authenticator step, the kill switch, n8n's machine account and
// notification, and every route and shape held against contracts/ai-v1/*.openapi.json.
//
//   node scripts/aiweb-staging-mock.test.mjs
import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AGENT_NOTICE_KINDS, LEAD_NOTICE_KINDS, PATTERNS, RECOVERY_CODE, REMINDER_KINDS, TOTP_CODE, createMock, signEvent } from '../infra/aiweb-staging/mock/server.mjs';

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
    assert.deepEqual(claims.scopes, [
      'franchiseApplicationNotify', 'morningSummaryNotify', 'aiAccessRequestNotify', 'customerReminderNotify', 'maintenanceDueNotify',
      'salesReportNotify', 'aiLeadNotify', 'aiAgentNotify', 'complianceDueNotify', 'qualityHoldNotify',
    ]);

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

test('n8n: customer reminders and the maintenance sweep need the machine token, today in Jakarta and nothing else', async () => {
  // 17:30Z on 25 Nov is 26 Nov in Jakarta: the mock's clock, so the date never straddles midnight.
  const mock = await boot({}, () => Date.parse('2026-11-25T17:30:00Z'));
  const send = (route, token, body) =>
    json('POST', mock.base, `/crm/api/v1/notifications/external/${route}`, body, token ? { authorization: `Bearer ${token}`, 'x-workflow': 'wf' } : {});
  const s = notifications.components.schemas;
  try {
    for (const route of ['customer-reminders', 'maintenance-due']) {
      assert.deepEqual(notifications.paths[`/crm/api/v1/notifications/external/${route}`].post.security, [{ machineToken: [] }]);
    }
    assert.deepEqual(REMINDER_KINDS, s.CustomerReminderTrigger.properties.kind.enum);
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const date = '2026-11-26';
    for (const kind of REMINDER_KINDS) {
      const ok = await send('customer-reminders', accessToken, { kind, date });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.deepEqual(body, { kind, date, candidates: 0, truncated: false, notified: 0, skipped: 0, whatsapp: 'pending' });
      assert.deepEqual(Object.keys(body).sort(), [...s.CustomerReminderResult.required].sort());
    }
    const due = await send('maintenance-due', accessToken, { date });
    assert.equal(due.status, 200);
    const dueBody = await due.json();
    assert.deepEqual(dueBody, { date, depots: 0, items: 0, notified: 0, remindLater: 0, whatsapp: 'pending' });
    assert.deepEqual(Object.keys(dueBody).sort(), [...s.MaintenanceDueResult.required].sort());
    assert.deepEqual(mock.state.calls.notifications.map((n) => n.eventId), [
      ...REMINDER_KINDS.map((k) => `customerReminderNotify:${k}:${date}`), `maintenanceDueNotify:${date}`,
    ]);

    for (const bad of [{ kind: 'NOPE', date }, { kind: 'UNPAID_ORDER', date: '2020-01-01' }, { kind: 'UNPAID_ORDER' }, { kind: 'UNPAID_ORDER', date, extra: 1 }, { date }, { kind: null, date }]) {
      assert.equal((await send('customer-reminders', accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await send('customer-reminders', accessToken, { kind: 'UNPAID_ORDER', date: '2026-11-25' })).status, 400, 'the UTC day is not today');
    for (const bad of [{ date: '2020-01-01' }, { date: '2026-11-25' }, {}, { date, kind: 'UNPAID_ORDER' }]) {
      assert.equal((await send('maintenance-due', accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await json('POST', mock.base, '/crm/api/v1/notifications/external/maintenance-due', [date], { authorization: `Bearer ${accessToken}` })).status, 400);
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    for (const [route, body] of [['customer-reminders', { kind: 'UNPAID_ORDER', date }], ['maintenance-due', { date }]]) {
      assert.equal((await send(route, human.accessToken, body)).status, 401);
      assert.equal((await send(route, null, body)).status, 401);
    }
  } finally {
    await mock.close();
  }
});

test('n8n: the compliance sweep and the quality hold relay need their machine scopes and the contract body', async () => {
  const mock = await boot({}, () => Date.parse('2026-11-25T17:30:00Z'));
  const send = (route, token, body) =>
    json('POST', mock.base, `/crm/api/v1/notifications/external/${route}`, body, token ? { authorization: `Bearer ${token}`, 'x-workflow': 'wf' } : {});
  const s = notifications.components.schemas;
  try {
    for (const route of ['compliance-due', 'quality-hold']) {
      assert.deepEqual(notifications.paths[`/crm/api/v1/notifications/external/${route}`].post.security, [{ machineToken: [] }]);
    }
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const due = await send('compliance-due', accessToken, { date: '2026-11-26' });
    assert.equal(due.status, 200);
    assert.deepEqual(Object.keys(await due.json()).sort(), [...s.ComplianceDueResult.required].sort());
    assert.equal((await send('compliance-due', accessToken, { date: '2026-11-25' })).status, 400);

    const event = { holdDepotId: randomUUID(), status: 'ACTIVE', changedAt: '2026-11-27T03:15:00.000Z' };
    assert.deepEqual(s.QualityHoldTrigger.properties.status.enum, ['ACTIVE', 'ENDED']);
    assert.deepEqual(Object.keys(s.QualityHoldTrigger.properties).sort(), Object.keys(event).sort());
    const ok = await send('quality-hold', accessToken, event);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body, { notified: 0, stale: true });
    assert.ok(Object.keys(body).every((k) => k in s.QualityHoldResult.properties));
    for (const bad of [{ ...event, holdDepotId: 'x' }, { ...event, depotId: event.holdDepotId, holdDepotId: undefined }, { ...event, status: 'GONE' }, { ...event, changedAt: 'yesterday' }, { ...event, extra: 1 }, {}]) {
      assert.equal((await send('quality-hold', accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    assert.equal((await send('quality-hold', human.accessToken, event)).status, 401);
    assert.equal((await send('quality-hold', null, event)).status, 401);
  } finally {
    await mock.close();
  }
});

test('n8n: the weekly Sales report trigger and the agent notice need their machine scopes and the contract body', async () => {
  // 25 Nov 2026 is a Wednesday: the week that just ended began Monday 16 Nov (9 days back).
  const mock = await boot({}, () => Date.parse('2026-11-25T03:00:00Z'));
  const send = (route, token, body) =>
    json('POST', mock.base, `/crm/api/v1/notifications/external/${route}`, body, token ? { authorization: `Bearer ${token}`, 'x-workflow': 'wf' } : {});
  const s = notifications.components.schemas;
  try {
    for (const route of ['sales-weekly-ready', 'ai-agent-notice']) {
      assert.deepEqual(notifications.paths[`/crm/api/v1/notifications/external/${route}`].post.security, [{ machineToken: [] }]);
    }
    assert.deepEqual(AGENT_NOTICE_KINDS, s.AiAgentNoticeTrigger.properties.kind.enum);
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const entity = randomUUID();
    const ok = await send('sales-weekly-ready', accessToken, { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: [entity] });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(Object.keys(body).sort(), [...s.SalesWeeklyReadyResult.required].sort());
    assert.equal(body.whatsapp, 'pending');
    for (const bad of [
      { eventId: 'sales-weekly:2026-11-23', weekStart: '2026-11-23', legalEntityIds: [entity] }, // this week, not the one that ended
      { eventId: 'sales-weekly:2026-11-17', weekStart: '2026-11-17', legalEntityIds: [entity] }, // not a Monday
      { eventId: 'sales-weekly:2026-11-09', weekStart: '2026-11-09', legalEntityIds: [entity] }, // too old
      { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-23', legalEntityIds: [entity] }, // eventId of another week
      { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: [] },
      { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: [entity, entity] },
      { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: ['nope'] },
      { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: [entity], extra: 1 },
    ]) {
      assert.equal((await send('sales-weekly-ready', accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    const notice = { eventId: 'agent-flag:7c1f0f64', agentId: 'keuangan', agentName: 'Agen Keuangan', kind: 'FLAG', bossRole: 'FINANCE' };
    const n = await send('ai-agent-notice', accessToken, notice);
    assert.equal(n.status, 200);
    assert.deepEqual(await n.json(), { recipients: 0, notified: 0, whatsapp: 'pending' });
    for (const bad of [{ ...notice, kind: 'NOPE' }, { ...notice, agentId: 'Keuangan' }, { ...notice, agentName: 'x'.repeat(41) }, { ...notice, depotId: 'x' }, { ...notice, bossRole: '1x' }, { agentId: 'keuangan' }]) {
      assert.equal((await send('ai-agent-notice', accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    for (const [route, b] of [['sales-weekly-ready', { eventId: 'sales-weekly:2026-11-16', weekStart: '2026-11-16', legalEntityIds: [entity] }], ['ai-agent-notice', notice]]) {
      assert.equal((await send(route, human.accessToken, b)).status, 401);
      assert.equal((await send(route, null, b)).status, 401);
    }
  } finally {
    await mock.close();
  }
});

test('n8n: the form lead notice needs aiLeadNotify, the contract body and an eventId that matches its kind', async () => {
  const mock = await boot();
  const send = (token, body) =>
    json('POST', mock.base, '/crm/api/v1/notifications/external/ai-lead-notice', body, token ? { authorization: `Bearer ${token}`, 'x-workflow': 'wf' } : {});
  const s = notifications.components.schemas;
  try {
    assert.deepEqual(notifications.paths['/crm/api/v1/notifications/external/ai-lead-notice'].post.security, [{ machineToken: [] }]);
    assert.deepEqual(LEAD_NOTICE_KINDS, s.AiLeadNoticeTrigger.properties.kind.enum);
    const { accessToken } = await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json();
    const prospectId = randomUUID();
    const notice = { eventId: `ai-lead:${prospectId}`, kind: 'NEW', prospectId, legalEntityId: randomUUID(), city: 'Bekasi', province: 'Jawa Barat' };
    const ok = await send(accessToken, notice);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(await ok.json()).sort(), [...s.AiLeadNoticeResult.required].sort());
    const overdue = { ...notice, kind: 'ESCALATE', eventId: `ai-lead-overdue:${prospectId}:ESCALATE`, picAccountId: randomUUID() };
    assert.equal((await send(accessToken, overdue)).status, 200);
    for (const bad of [
      { ...notice, kind: 'NOPE' },
      { ...notice, eventId: `ai-lead-overdue:${prospectId}:NEW` }, // the eventId of another kind
      { ...overdue, eventId: `ai-lead:${prospectId}` },
      { ...notice, city: 'www.example.com' }, // a link is not a place name
      { ...notice, phone: '0812' }, // nothing personal passes
      { ...notice, legalEntityId: 'nope' },
      { kind: 'NEW' },
    ]) {
      assert.equal((await send(accessToken, bad)).status, 400, JSON.stringify(bad));
    }
    const p = pkce();
    const { code } = await pick(mock, user('SUPER_ADMIN'), p);
    const human = await (await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE })).json();
    assert.equal((await send(human.accessToken, notice)).status, 401);
    assert.equal((await send(null, notice)).status, 401);
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

// ------------------------------------------------------------------ the read API and "Minta akses"
const read = contract('read');
const approvals = contract('approvals');
const READ_PATH = '/dashboard/api/v1/ai/read';
const WIB_DAY = (n) => new Date(Date.parse('2026-11-25T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const FAKE_DEPOTS = fixtures.depots.map((d) => d.id);

async function tokenOf(mock, person) {
  const p = pkce();
  const { code } = await pick(mock, person, p);
  const r = await json('POST', mock.base, '/auth/api/v1/auth/handoff/token', { code, codeVerifier: p.verifier, totp: TOTP_CODE });
  return (await r.json()).accessToken;
}
const machineToken = async (mock) =>
  (await (await json('POST', mock.base, '/auth/api/v1/auth/machine/token', { accountId: MACHINE.id, secret: MACHINE.secret })).json()).accessToken;
const get = (mock, path, token) => fetch(`${mock.base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

/** The envelope, checked against the contract's required fields, enums and the metric's own unit. */
function assertEnvelope(body, group, metric) {
  const s = read.components.schemas;
  for (const f of s.AnswerEnvelope.required) assert.ok(body[f] !== undefined, `envelope has ${f}`);
  for (const f of s.Period.required) assert.ok(body.period[f] !== undefined, `period has ${f}`);
  assert.equal(body.period.timeZone, s.Period.properties.timeZone.enum[0]);
  assert.ok(s.Period.properties.unit.enum.includes(body.period.unit));
  for (const f of s.Scope.required) assert.ok(Array.isArray(body.scope[f]), `scope has ${f}`);
  assert.ok(s.AnswerEnvelope.properties.status.enum.includes(body.status));
  assert.ok(!Number.isNaN(Date.parse(body.asOf)));
  if (metric) {
    const spec = read.paths[`${READ_PATH}/${group}`].get['x-metrics'][metric];
    assert.ok(spec, `${metric} is a metric of ${group} in the contract`);
    assert.equal(body.unit, spec.unit);
    assert.equal(body.metricId, metric);
  }
}
const splitOf = (body) => {
  const s = read.components.schemas.DepotSplit;
  for (const f of s.required) assert.ok(body.value[f] !== undefined, `split has ${f}`);
  for (const row of body.value.byDepot) for (const f of s.properties.byDepot.items.required) assert.ok(row[f] !== undefined);
  return new Map(body.value.byDepot.map((r) => [r.depotId, r.value]));
};

test('the read API: scope, split and plain answers hold the contract, and follow the token', async () => {
  const mock = await boot();
  try {
    const hq = await tokenOf(mock, user('HR'));
    const scope = await (await get(mock, `${READ_PATH}/scope?period=day&date=2026-11-24`, hq)).json();
    assertEnvelope(scope, 'scope', null);
    assert.equal(scope.metricId, 'meta.scope');
    assert.equal(scope.unit, 'depot');
    assert.equal(scope.value, FAKE_DEPOTS.length);
    for (const d of scope.depots) for (const f of read.components.schemas.ScopeDepot.required) assert.ok(d[f]);
    assert.deepEqual(scope.depots.map((d) => d.depotId), FAKE_DEPOTS);
    assert.deepEqual(scope.scope.depotIds, FAKE_DEPOTS);
    // Every metric the AI web asks, split and not.
    const asks = [['money', 'P-01', 'day'], ['money', 'P-07', 'day'], ['gallons', 'G-01', 'day'], ['customers', 'C-01', 'month']];
    for (const [group, metric, period] of asks) {
      const date = period === 'month' ? '2026-10-15' : '2026-11-24';
      const plain = await (await get(mock, `${READ_PATH}/${group}?metric=${metric}&period=${period}&date=${date}`, hq)).json();
      assertEnvelope(plain, group, metric);
      assert.equal(typeof plain.value, 'number');
      if (group === 'customers') {
        assert.equal(plain.period.from, '2026-10-01');
        assert.equal(plain.period.to, '2026-10-31');
        assert.equal((await get(mock, `${READ_PATH}/customers?metric=C-01&period=month&date=${date}&split=depot`, hq)).status, 400);
        continue;
      }
      const body = await (await get(mock, `${READ_PATH}/${group}?metric=${metric}&period=${period}&date=${date}&split=depot`, hq)).json();
      assertEnvelope(body, group, metric);
      const rows = splitOf(body);
      assert.deepEqual([...rows.keys()], FAKE_DEPOTS);
      assert.equal(body.value.total, plain.value, 'total is exactly the unsplit answer');
      assert.equal([...rows.values()].reduce((a, b) => a + b, 0), body.value.total);
      const again = await (await get(mock, `${READ_PATH}/${group}?metric=${metric}&period=${period}&date=${date}&split=depot`, hq)).json();
      assert.deepEqual(again.value, body.value, 'the same date, the same numbers');
    }
    // A week is the sum of its seven days.
    const week = await (await get(mock, `${READ_PATH}/money?metric=P-01&period=week&date=2026-11-24`, hq)).json();
    assert.equal(week.period.from, '2026-11-23');
    assert.equal(week.period.to, '2026-11-29');
    let sum = 0;
    for (let i = 23; i <= 29; i += 1) sum += (await (await get(mock, `${READ_PATH}/money?metric=P-01&period=day&date=2026-11-${i}`, hq)).json()).value;
    assert.equal(week.value, sum);

    // A depot-bound person reads only that depot.
    const depot = user('SUPERVISOR');
    const mine = await tokenOf(mock, depot);
    const one = await (await get(mock, `${READ_PATH}/scope?period=day&date=2026-11-24`, mine)).json();
    assert.deepEqual(one.depots.map((d) => d.depotId), [depot.depotId]);
    const split = await (await get(mock, `${READ_PATH}/money?metric=P-01&period=day&date=2026-11-24&split=depot`, mine)).json();
    assert.deepEqual([...splitOf(split).keys()], [depot.depotId]);
  } finally {
    await mock.close();
  }
});

test('the read API: "% dari biasanya" shows variety on any day, above 100 and below 100', async () => {
  const mock = await boot();
  try {
    const hq = await tokenOf(mock, user('HR'));
    const money = async (date) => splitOf(await (await get(mock, `${READ_PATH}/money?metric=P-01&period=day&date=${date}&split=depot`, hq)).json());
    for (let back = 0; back < 30; back += 1) {
      const yesterday = await money(WIB_DAY(-1 - back));
      const past = await Promise.all([1, 2, 3, 4].map((w) => money(WIB_DAY(-1 - back - 7 * w))));
      const pct = FAKE_DEPOTS.map((id) => (yesterday.get(id) / (past.reduce((a, m) => a + m.get(id), 0) / 4)) * 100);
      assert.ok(pct.some((p) => p > 100) && pct.some((p) => p < 100), `${WIB_DAY(-1 - back)}: ${pct.map((p) => p.toFixed(0))}`);
    }
  } finally {
    await mock.close();
  }
});

test('the read API: targets hold the contract, match P-01 and G-01 sums, and one depot has no target', async () => {
  const mock = await boot();
  try {
    const hq = await tokenOf(mock, user('HR'));
    const body = async (path) => (await get(mock, `${READ_PATH}/${path}`, hq)).json();
    for (const [metric, base, group] of [['T-01', 'P-01', 'money'], ['T-02', 'G-01', 'gallons']]) {
      const q = `period=month&date=2026-10-15`;
      const split = await body(`targets?metric=${metric}&${q}&split=depot`);
      assertEnvelope(split, 'targets', metric);
      for (const f of ['target', 'actual', 'pct', 'byDepot']) assert.ok(split.value[f] !== undefined, `value has ${f}`);
      const baseSplit = await body(`${group}?metric=${base}&${q}&split=depot`);
      assert.equal(split.value.actual, baseSplit.value.total, 'actual is the base metric');
      assert.deepEqual(split.value.byDepot.map((r) => r.depotId), FAKE_DEPOTS);
      for (const r of split.value.byDepot) {
        for (const f of read.components.schemas.DepotSplit.properties.byDepot.items.required.filter((x) => x !== 'value')) assert.ok(r[f] !== undefined);
        assert.equal(r.actual, baseSplit.value.byDepot.find((b) => b.depotId === r.depotId).value);
      }
      const rows = split.value.byDepot;
      assert.equal(rows.at(-1).target, null, 'the last depot has no target');
      assert.equal(rows.at(-1).pct, null);
      assert.ok(rows.slice(0, -1).every((r) => r.target > 0 && r.pct === Math.round((r.actual / r.target) * 1000) / 10));
      assert.equal(split.value.target, null, 'no network target while a depot has none');
      assert.equal(split.value.pct, null);
      const plain = await body(`targets?metric=${metric}&${q}`);
      assert.equal(plain.status, 'belum_ada');
      assert.equal(plain.value, null);
      assert.ok(plain.reason);
    }
    // a depot-bound person reads only a depot that has a target: the plain answer is the whole cell
    const kepala = await tokenOf(mock, user('KEPALA_DEPOT'));
    const mine = await (await get(mock, `${READ_PATH}/targets?metric=T-01&period=month&date=2026-10-15`, kepala)).json();
    assert.equal(mine.status, 'ok');
    assert.deepEqual(Object.keys(mine.value), ['target', 'actual', 'pct']);
    assert.equal(mine.value.target, fixtures.depots[0].target['T-01']);
    // not a whole month: 400, like C-01
    for (const q of ['period=day&date=2026-10-15', 'period=week&date=2026-10-15', 'period=year&date=2026-10-15']) {
      assert.equal((await get(mock, `${READ_PATH}/targets?metric=T-01&${q}`, hq)).status, 400);
    }
    // a future month sums nothing (the running month's actual stops at today)
    const future = await (await get(mock, `${READ_PATH}/targets?metric=T-01&period=month&date=2999-01-15&split=depot`, hq)).json();
    assert.equal(future.status, 'ok');
    assert.equal(future.value.actual, 0);
    assert.deepEqual(future.value.byDepot.map((r) => r.pct), [0, 0, 0, null]);
    assert.equal((await get(mock, `${READ_PATH}/targets?metric=T-04&period=month`, hq)).status, 404);
    assert.equal((await get(mock, `${READ_PATH}/targets?metric=T-01&period=month&split=zone`, hq)).status, 400);
    assert.equal((await get(mock, `${READ_PATH}/targets?metric=T-01&period=month`)).status, 401);
  } finally {
    await mock.close();
  }
});

test('the read API: targets with no target anywhere are belum_ada, even split by depot', async () => {
  const f = structuredClone(fixtures);
  for (const d of f.depots) delete d.target;
  const dir = mkdtempSync(join(tmpdir(), 'mock-fx-'));
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(f));
  const mock = createMock({ env: { MOCK_AI_WEB_URL: AI_WEB, MOCK_MACHINE_ID: MACHINE.id, MOCK_MACHINE_SECRET: MACHINE.secret }, fixturesPath: join(dir, 'fixtures.json') });
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  mock.base = `http://127.0.0.1:${mock.server.address().port}`;
  try {
    const hq = await tokenOf(mock, user('HR'));
    const r = await (await get(mock, `${READ_PATH}/targets?metric=T-01&period=month&date=2026-10-15&split=depot`, hq)).json();
    assert.equal(r.status, 'belum_ada');
    assert.equal(r.value, null);
    assert.ok(r.reason);
  } finally {
    await new Promise((r) => mock.server.close(r));
    rmSync(dir, { recursive: true });
  }
});

test('the read API: visits, H-01, H-02, H-07 and the extra money metrics hold the contract (AI-21)', async () => {
  const mock = await boot({}, () => Date.parse('2026-12-10T03:00:00Z'));
  try {
    const hq = await tokenOf(mock, user('HEAD_OFFICE'));
    const q = (group, metric, rest = '') => get(mock, `${READ_PATH}/${group}?metric=${metric}${rest}`, hq);
    const month = '&period=month&date=2026-11-10';
    // V-01 / V-04: plain and split, total = sum
    for (const m of ['V-01', 'V-04']) {
      const plain = await (await q('visits', m, month)).json();
      assertEnvelope(plain, 'visits', m);
      const split = await (await q('visits', m, `${month}&split=depot`)).json();
      assert.equal(split.value.total, plain.value);
      assert.deepEqual([...splitOf(split).keys()], FAKE_DEPOTS);
    }
    // V-02: only per depot, null = never visited; V-03: totals and per depot
    const v2none = await (await q('visits', 'V-02')).json();
    assert.equal(v2none.status, 'belum_ada');
    const v2 = await (await q('visits', 'V-02', '&split=depot')).json();
    assertEnvelope(v2, 'visits', 'V-02');
    assert.equal(v2.value.byDepot.at(-1).days, null);
    const v3 = await (await q('visits', 'V-03', '&split=depot')).json();
    assert.deepEqual(v3.value.byDepot.map((r) => r.depotId), FAKE_DEPOTS);
    assert.equal(v3.value.overdue, v3.value.byDepot.reduce((a, r) => a + r.overdue, 0));
    // a role outside the visits group is refused; a depot-bound supervisor sees its own depot
    assert.equal((await get(mock, `${READ_PATH}/visits?metric=V-01`, await tokenOf(mock, user('FINANCE')))).status, 403);
    const mine = await (await get(mock, `${READ_PATH}/visits?metric=V-03&split=depot`, await tokenOf(mock, user('SUPERVISOR')))).json();
    assert.equal(mine.value.byDepot.length, 1);
    // H-01 holds the depot of 2 and a neighbour; H-07 a plain percent, held for a group of 2
    const h1 = await (await q('hr', 'H-01', '&date=2026-12-10')).json();
    assertEnvelope(h1, 'hr', 'H-01');
    assert.deepEqual(h1.value.byDepot.map((r) => r.flag), [undefined, undefined, 'ditahan', 'kurang dari 3']);
    const h7 = await (await q('hr', 'H-07', month)).json();
    assertEnvelope(h7, 'hr', 'H-07');
    assert.equal(h7.value, 10.3);
    assert.equal((await q('hr', 'H-07', `${month}&split=depot`)).status, 400);
    const h2 = await (await q('hr', 'H-02', month)).json();
    assert.equal(h2.value.rate.status, 'ok');
    const open = await (await q('hr', 'H-07', '&period=month&date=2026-12-01')).json();
    assert.equal(open.status, 'belum_ada');
    // money extras: ditahan L-07, belum_ada L-08, split only where the contract says
    assert.equal((await (await q('money', 'L-07', month)).json()).status, 'ditahan');
    assert.equal((await (await q('money', 'L-08', month)).json()).status, 'belum_ada');
    assert.equal(typeof (await (await q('money', 'L-06', month)).json()).value, 'number');
    assertEnvelope(await (await q('money', 'U-04', `${month}&split=depot`)).json(), 'money', 'U-04');
    assert.equal((await q('money', 'P-03', `${month}&split=depot`)).status, 400);
    assert.equal((await q('money', 'P-03', month)).status, 200);
  } finally {
    await mock.close();
  }
});

test('the read API: refusals use the contract shape (401, 403, 404, 400)', async () => {
  const mock = await boot();
  try {
    const hq = await tokenOf(mock, user('HR'));
    const refusal = async (res, status, code) => {
      assert.equal(res.status, status);
      const body = await res.json();
      for (const f of read.components.schemas.Error.required) assert.ok(body[f] !== undefined, `error has ${f}`);
      assert.equal(body.code, code);
    };
    const money = `${READ_PATH}/money?period=day&date=2026-11-24`;
    await refusal(await get(mock, `${money}&metric=P-01`), 401, 'UNAUTHORIZED');
    await refusal(await get(mock, `${money}&metric=P-01`, 'nope'), 401, 'UNAUTHORIZED');
    await refusal(await get(mock, `${money}&metric=P-01`, await machineToken(mock)), 403, 'FORBIDDEN');
    await refusal(await get(mock, `${money}&metric=P-01`, await tokenOf(mock, user('FRANCHISE_OWNER'))), 403, 'FORBIDDEN');
    await refusal(await get(mock, `${money}&metric=G-01`, hq), 404, 'NOT_FOUND');
    await refusal(await get(mock, `${money}&metric=ZZ-99`, hq), 404, 'NOT_FOUND');
    await refusal(await get(mock, money, hq), 400, 'BAD_REQUEST');
    await refusal(await get(mock, `${READ_PATH}/money?metric=P-01&period=day&date=2026-02-31`, hq), 400, 'BAD_REQUEST');
    await refusal(await get(mock, `${READ_PATH}/money?metric=P-01&period=decade&date=2026-11-24`, hq), 400, 'BAD_REQUEST');
    await refusal(await get(mock, `${READ_PATH}/customers?metric=C-01&date=2026-11-24`, hq), 400, 'BAD_REQUEST');
    const dflt = await (await get(mock, `${READ_PATH}/money?metric=P-01&date=2026-11-24`, hq)).json();
    assert.equal(dflt.period.unit, 'day', 'period defaults to day');
    assert.equal(dflt.period.from, '2026-11-24');
    await refusal(await get(mock, `${money}&metric=P-01&split=legal`, hq), 400, 'BAD_REQUEST');
    for (const group of ['money', 'gallons', 'customers', 'scope']) {
      for (const s of ['200', '400', '401', '403']) assert.ok(read.paths[`${READ_PATH}/${group}`].get.responses[s], `${group} documents ${s}`);
    }
    // The kill switch makes every token worthless, as the empty key set does.
    await fetch(`${mock.base}/_mock/kill`, { method: 'POST', redirect: 'manual' });
    await refusal(await get(mock, `${money}&metric=P-01`, hq), 401, 'UNAUTHORIZED');
  } finally {
    await mock.close();
  }
});

test('pending approvals: the queues of the contract, fewer for a depot-bound person', async () => {
  const mock = await boot();
  const path = '/dashboard/api/v1/dashboard/pending-approvals';
  try {
    assert.ok(approvals.paths[path]);
    const q = approvals.components.schemas.PendingQueue;
    const check = (body) => {
      assert.ok(Array.isArray(body.queues) && body.queues.length > 0);
      for (const item of body.queues) {
        for (const f of q.required) assert.ok(item[f] !== undefined, `queue has ${f}`);
        assert.ok(q.properties.key.enum.includes(item.key));
        assert.ok(item.href.startsWith('/'));
        assert.ok(Number.isInteger(item.count) && item.count >= 0);
        assert.equal(item.oldestAt === null, item.count === 0);
        assert.ok(item.oldestAt === null || !Number.isNaN(Date.parse(item.oldestAt)));
      }
      return body.queues.map((i) => i.key);
    };
    const hq = check(await (await get(mock, path, await tokenOf(mock, user('HR')))).json());
    const depot = check(await (await get(mock, path, await tokenOf(mock, user('SUPERVISOR')))).json());
    assert.ok(hq.length > depot.length);
    assert.equal((await get(mock, path)).status, 401);
    assert.equal((await get(mock, path, await machineToken(mock))).status, 403);
    assert.equal((await get(mock, path, await tokenOf(mock, user('FRANCHISE_OWNER')))).status, 403);
  } finally {
    await mock.close();
  }
});

test('n8n: ai-access-requested needs its machine scope, validates the body, and keeps the caps', async () => {
  const mock = await boot();
  const path = '/crm/api/v1/notifications/external/ai-access-requested';
  const send = (token, body) => json('POST', mock.base, path, body, token ? { authorization: `Bearer ${token}`, 'x-workflow': 'ai7-access-request' } : {});
  const ask = (requester, extra = {}) => ({ eventId: `ai-access-request:${randomUUID()}`, requesterAccountId: requester.id, ...extra });
  try {
    const op = notifications.paths[path].post;
    const schema = notifications.components.schemas.AiAccessRequestedNotify;
    const result = notifications.components.schemas.AiAccessRequestedResult;
    for (const s of ['200', '400', '401', '403']) assert.ok(op.responses[s], `documents ${s}`);
    const token = await machineToken(mock);
    assert.ok(verifyToken(token, await jwks(mock)).scopes.includes('aiAccessRequestNotify'));
    const checkResult = async (res) => {
      assert.equal(res.status, 200);
      const body = await res.json();
      for (const f of result.required) assert.ok(body[f] !== undefined, `result has ${f}`);
      assert.ok(Number.isInteger(body.recipients) && Number.isInteger(body.notified));
      assert.deepEqual(result.properties.whatsapp.enum, [body.whatsapp]);
      if (body.capped !== undefined) assert.equal(body.capped, true);
      return body;
    };
    const asker = user('HEAD_OFFICE');

    // Who may call: nobody, a person.
    assert.equal((await send(null, ask(asker))).status, 401);
    assert.equal((await send(await tokenOf(mock, user('HR')), ask(asker))).status, 401);

    // A known requester: told and recorded; the same eventId again is not new.
    const first = ask(asker, { legalEntityIds: [randomUUID()], group: 'money' });
    assert.deepEqual(await checkResult(await send(token, first)), { recipients: 1, notified: 1, whatsapp: 'pending' });
    assert.deepEqual(await checkResult(await send(token, first)), { recipients: 1, notified: 1, whatsapp: 'pending' });
    assert.equal(mock.state.calls.notifications.length, 1);
    assert.equal(mock.state.calls.notifications[0].workflow, 'ai7-access-request');
    // An unknown requester, and one who can already grant: nobody told, nothing counted.
    const unknown = await checkResult(await send(token, { eventId: `ai-access-request:${randomUUID()}`, requesterAccountId: randomUUID() }));
    assert.deepEqual([unknown.recipients, unknown.notified], [0, 0]);
    assert.equal((await checkResult(await send(token, ask(user('SUPER_ADMIN'))))).recipients, 0);
    assert.equal(mock.state.calls.notifications.length, 1);

    // The cap: 3 distinct eventIds per requester, then capped true; a retry of a filed one still passes.
    assert.equal((await checkResult(await send(token, ask(asker)))).notified, 1);
    assert.equal((await checkResult(await send(token, ask(asker)))).notified, 1);
    const capped = await checkResult(await send(token, ask(asker)));
    assert.deepEqual([capped.notified, capped.capped], [0, true]);
    assert.equal((await checkResult(await send(token, first))).notified, 1);
    assert.equal((await checkResult(await send(token, ask(user('FINANCE'))))).notified, 1, 'another requester is not capped');

    // Validation: an unknown field (a name), missing or malformed ids, a repeat, too many, a group not listed.
    const uuid = randomUUID();
    const bad = [
      ask(asker, { name: 'Budi' }),
      { requesterAccountId: asker.id },
      { eventId: `ai-access-request:${randomUUID()}` },
      { eventId: 'ai-access-request:nope', requesterAccountId: asker.id },
      ask(asker, { requesterAccountId: 'x' }),
      ask(asker, { legalEntityIds: ['x'] }),
      ask(asker, { legalEntityIds: [uuid, uuid.toUpperCase()] }),
      ask(asker, { legalEntityIds: Array.from({ length: 21 }, () => randomUUID()) }),
      ask(asker, { group: 'everything' }),
    ];
    for (const body of bad) assert.equal((await send(token, body)).status, 400, JSON.stringify(body).slice(0, 70));
    for (const group of schema.properties.group.enum) assert.equal((await send(token, ask(user('MARKETING'), { group }))).status, 200);
  } finally {
    await mock.close();
  }
});

const drafts = contract('drafts');

test('CRM calon mitra: access, depot draft with the D1 re-check, replay and status (HD-21a)', async () => {
  const mock = await boot();
  const base = '/depot/api/v1/ai';
  const FROM_CRM = `${base}/drafts/depots/from-crm`;
  const PROSPECT = '00000000-0000-4000-8000-0000000000a1';
  try {
    for (const path of [`${base}/crm/access`, FROM_CRM, `${FROM_CRM}/{prospectId}`]) assert.ok(drafts.paths[path], `${path} is in drafts.openapi.json`);
    const sales = await tokenOf(mock, user('MARKETING'));
    const cp = drafts.components.schemas.CrmDepotDraft;
    const say = (token, body, id = PROSPECT) => json('POST', mock.base, FROM_CRM, body, { authorization: `Bearer ${token}`, 'x-ai-suggestion-id': id });
    const ok = (over = {}) => ({
      prospectId: PROSPECT,
      legacyApplicationId: null,
      proposedName: 'Depot Contoh',
      city: 'Bekasi',
      province: 'Jawa Barat',
      owner: { fullName: 'Budi Contoh', phoneE164: '+6281234567890' },
      prospectusHandedOn: '2026-10-01',
      prospectusSha256: 'a'.repeat(64),
      prospectusVersionLabel: 'v1',
      prospectusReceipt: 'Tanda terima 1',
      agreementSignedOn: '2026-10-20',
      checklist: { ktpNpwp: 'VERIFIED', locationProof: 'VERIFIED', capitalDeposit: 'VERIFIED', fieldSurvey: 'VERIFIED' },
      ...over,
    });
    for (const f of cp.required) assert.ok(f in ok(), `the fixture sends ${f}`);

    // Access: the contract's shape, the one fixed legal entity, and only for people who may enter.
    const access = await (await get(mock, `${base}/crm/access`, sales)).json();
    const a = drafts.components.schemas.CrmAccess;
    for (const f of a.required) assert.ok(access[f] !== undefined, `access has ${f}`);
    assert.deepEqual(access, { full: true, settings: true, legalEntities: [{ id: '00000000-0000-4000-8000-000000000001', name: 'PT Contoh Waralaba' }] });
    assert.equal((await get(mock, `${base}/crm/access`)).status, 401);
    assert.equal((await get(mock, `${base}/crm/access`, await tokenOf(mock, user('SUPERVISOR')))).status, 403);
    assert.equal((await get(mock, `${base}/crm/access`, await machineToken(mock))).status, 403);

    // AI-29: the Tim AI screen's access read follows the built-in matrix; 401 / 403 as the CRM's.
    const teamUrl = '/depot/api/v1/ai/team/access';
    assert.ok(drafts.paths[teamUrl], 'team access is in drafts.openapi.json');
    const team = await (await get(mock, teamUrl, sales)).json();
    for (const f of drafts.components.schemas.AiTeamAccess.required) assert.ok(team[f] !== undefined, `team access has ${f}`);
    assert.deepEqual(team, { read: true, manage: false, stop: false, role: 'MARKETING' });
    assert.equal((await get(mock, teamUrl)).status, 401);
    assert.equal((await get(mock, teamUrl, await tokenOf(mock, user('SUPERVISOR')))).status, 403);
    assert.equal((await get(mock, teamUrl, await machineToken(mock))).status, 403);

    // Draft: 201, then 200 for the same body, 409 for another, with the contract's statuses.
    const documented = new Set(Object.keys(drafts.paths[FROM_CRM].post.responses));
    for (const s of [200, 201, 400, 401, 403, 409, 422]) assert.ok(documented.has(String(s)), `documents ${s}`);
    const first = await say(sales, ok());
    assert.equal(first.status, 201);
    const made = await first.json();
    for (const f of drafts.components.schemas.CrmDepotDraftCreated.required) assert.ok(made[f] !== undefined, `created has ${f}`);
    assert.equal(made.status, 'DRAFT');
    const again = await say(sales, ok());
    assert.equal(again.status, 200);
    assert.equal((await again.json()).draftId, made.draftId);
    const clash = await say(sales, ok({ city: 'Depok' }));
    assert.equal(clash.status, 409);
    assert.equal((await clash.json()).code, 'DRAFT_CONFLICT');

    // Status.
    const st = await (await get(mock, `${FROM_CRM}/${PROSPECT}`, sales)).json();
    for (const f of drafts.components.schemas.CrmDepotDraftStatus.required) assert.ok(st[f] !== undefined, `status has ${f}`);
    assert.deepEqual([st.draftId, st.status, st.depotId, st.depotCode], [made.draftId, 'DRAFT', null, null]);
    assert.equal((await get(mock, `${FROM_CRM}/00000000-0000-4000-8000-0000000000a2`, sales)).status, 404);
    assert.equal((await get(mock, `${FROM_CRM}/nope`, sales)).status, 400);

    // D1: exactly 14 days passes, 13 is refused with earliestOn; a lacking item lists the items; dates are 400.
    const other = '00000000-0000-4000-8000-0000000000a3';
    const at = (over) => say(sales, ok({ prospectId: other, ...over }), over.prospectId ?? other);
    assert.equal((await at({ prospectusHandedOn: '2026-11-01', agreementSignedOn: '2026-11-15' })).status, 201);
    const early = await at({ prospectId: '00000000-0000-4000-8000-0000000000a4', prospectusHandedOn: '2026-11-01', agreementSignedOn: '2026-11-14' });
    assert.equal(early.status, 422);
    assert.deepEqual(await early.json(), { statusCode: 422, code: 'COOLING_OFF_NOT_MET', message: 'The agreement may not be signed yet.', earliestOn: '2026-11-15' });
    const lacking = await at({ prospectId: '00000000-0000-4000-8000-0000000000a5', checklist: { ...ok().checklist, fieldSurvey: 'SUBMITTED', ktpNpwp: 'REJECTED' } });
    assert.equal(lacking.status, 422);
    const lb = await lacking.json();
    assert.equal(lb.code, 'CHECKLIST_INCOMPLETE');
    assert.deepEqual(lb.items, ['ktpNpwp', 'fieldSurvey']);
    assert.equal((await at({ prospectId: '00000000-0000-4000-8000-0000000000a6', agreementSignedOn: '2099-01-01' })).status, 400);
    assert.equal((await at({ prospectId: '00000000-0000-4000-8000-0000000000a7', prospectusHandedOn: '2026-10-20', agreementSignedOn: '2026-10-01' })).status, 400);

    // An upper-case prospect id is the same prospect (replay), and the header must equal the body's id.
    const upper = await say(sales, ok({ prospectId: PROSPECT.toUpperCase() }), PROSPECT.toUpperCase());
    assert.equal(upper.status, 200);
    assert.equal((await upper.json()).draftId, made.draftId);
    const mismatch = await say(sales, ok(), '00000000-0000-4000-8000-0000000000a9');
    assert.equal(mismatch.status, 400);

    // Validation, the header, and who may call.
    assert.equal((await say(sales, ok({ prospectusSha256: 'A'.repeat(64) }))).status, 400);
    assert.equal((await say(sales, { ...ok(), extra: 1 })).status, 400);
    assert.equal((await say(sales, ok(), 'not-a-uuid')).status, 400);
    assert.equal((await say(await tokenOf(mock, user('SUPERVISOR')), ok())).status, 403);
    assert.equal((await json('POST', mock.base, FROM_CRM, ok(), { 'x-ai-suggestion-id': PROSPECT })).status, 401);

    // Reset empties the drafts.
    await fetch(`${mock.base}/_mock/reset`, { method: 'POST', redirect: 'manual' });
    assert.equal((await get(mock, `${FROM_CRM}/${PROSPECT}`, sales)).status, 404);
  } finally {
    await mock.close();
  }
});

test('CRM calon mitra: the legacy applications and the PIC candidates hold the contract (HD-21 sections 5 and 6)', async () => {
  const mock = await boot();
  const legacyPath = '/depot/api/v1/ai/crm/legacy-applications';
  const picPath = '/auth/api/v1/ai/crm/pic-candidates';
  try {
    for (const path of [legacyPath, picPath]) assert.ok(drafts.paths[path], `${path} is in drafts.openapi.json`);
    const sales = await tokenOf(mock, user('MARKETING'));
    const legacy = await (await get(mock, legacyPath, sales)).json();
    const l = drafts.components.schemas.LegacyApplication;
    assert.equal(legacy.applications.length, 2);
    assert.equal(legacy.truncated, false);
    for (const f of drafts.components.schemas.LegacyApplications.required) assert.ok(legacy[f] !== undefined, `response has ${f}`);
    assert.deepEqual(legacy.applications.map((a) => a.stage), ['PENDING', 'SURVEY']);
    for (const a of legacy.applications) {
      for (const f of l.required) assert.ok(a[f] !== undefined, `application has ${f}`);
      assert.ok(l.properties.stage.enum.includes(a.stage));
      assert.match(a.applicantPhoneE164, new RegExp(l.properties.applicantPhoneE164.pattern));
      assert.deepEqual(Object.keys(a).sort(), [...l.required].sort());
    }
    assert.equal(legacy.applications[0].applicantName, 'Calon Contoh Satu');
    assert.equal(legacy.applications[0].applicantPhoneE164, '+6281200000001');
    assert.ok(legacy.applications[0].submittedAt < legacy.applications[1].submittedAt, 'oldest first');

    const pics = await (await get(mock, picPath, sales)).json();
    const pl = drafts.components.schemas.PicCandidates.properties.people;
    assert.equal(pics.people.length, 2);
    for (const p of pics.people) {
      assert.deepEqual(Object.keys(p).sort(), [...pl.items.required].sort());
      assert.match(p.id, /^[0-9a-f-]{36}$/);
    }
    assert.ok(pics.people.length <= pl.maxItems);

    // Same refusals as the other CRM routes.
    for (const path of [legacyPath, picPath]) {
      assert.equal((await get(mock, path)).status, 401);
      assert.equal((await get(mock, path, await tokenOf(mock, user('SUPERVISOR')))).status, 403);
      assert.equal((await get(mock, path, await machineToken(mock))).status, 403);
      assert.equal((await fetch(`${mock.base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${sales}` } })).status, 404);
    }
  } finally {
    await mock.close();
  }
});
