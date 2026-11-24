// A fake hydromart-digital for the AI web's staging copy (D3 staging, part A).
//
// It stands in for the three things the AI web and its n8n call on hydromart, with made-up
// people (fixtures.json) and its own throwaway signing key, so staging never needs a production
// secret and never touches production. Node standard library only.
//
//   GET  /ai/masuk                      the hand-over page: pick a fake person, get a one-time code
//   POST /ai/masuk                      the pick
//   GET  /auth/api/v1/auth/jwks         the public key (empty set when switched off)
//   POST /auth/api/v1/auth/handoff/token  code + PKCE verifier (+ authenticator code) -> token
//   POST /auth/api/v1/auth/machine/token  n8n's machine account -> token
//   POST /crm/api/v1/notifications/external/franchise-application-submitted   n8n's notification
//   POST /crm/api/v1/notifications/external/morning-summary   n8n's 07.00 WIB summary (AI-9)
//   POST /alert                         the AI web's alarm webhook
//   GET  /health                        for the container's health check
//   GET  /_mock/ , /_mock/calls         what arrived; kill switch, signed event, reset
//
// The shapes follow contracts/ai-v1/*.openapi.json in this repository; the contract test
// (scripts/aiweb-staging-mock.test.mjs) holds them together, patterns included.
//
// Env (all optional unless said):
//   MOCK_PORT              9911
//   MOCK_AI_WEB_URL        the AI web's origin: the only return address a code is issued for
//                          (auth-service's AI_WEB_RETURN_URL is that plus /masuk/callback)
//   MOCK_SIGNING_KEY       EC P-256 private key, PKCS8 DER, base64. Made at start when absent,
//                          then sessions end with the process.
//   MOCK_MACHINE_ID, MOCK_MACHINE_SECRET   n8n's machine account (without them none is accepted)
//   MOCK_HD_EVENT_SECRET   signs the events the /_mock/ button sends to the AI web
//   MOCK_INGRESS_URL       where it sends them (http://aiweb:3000/api/ingress/hd)
//
// Not production: the authenticator code is the fixed 123456, the recovery code STAGE-ABCDE, and
// every state (codes, counters, calls) lives in memory and ends with the process.
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signBytes,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const TOTP_CODE = '123456';
export const RECOVERY_CODE = 'STAGE-ABCDE';
const CODE_TTL_MS = 60_000;
const KEPT_TTL_MS = 60_000;
const TOKEN_TTL_S = 900;
const TICKET_TTL_S = 43_200;
const LOCK_AFTER = 5;
const LOCK_S = 300;
const MAX_BODY = 64 * 1024;
// Memory stays flat however long it runs: logs keep the newest entries, maps their newest keys.
const MAX_LOG = 200;
const MAX_KEYS = 10_000;
const MAX_CODES = 1_000;

/** hydromart's delivery signature (events.openapi.json): sha256= and the HMAC of "<ts>.<raw body>". */
export const signEvent = (secret, timestamp, raw) =>
  'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
function keep(list, entry) {
  list.push(entry);
  if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG);
}
function setBounded(map, key, value, max = MAX_KEYS) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

// Copied from the contracts (the test compares them with the files, so they cannot drift).
export const PATTERNS = {
  code: '^[A-Za-z0-9_-]{43}$',
  codeVerifier: '^[A-Za-z0-9._~-]{43,128}$',
  totp: '^\\d{6}$',
  recoveryCode: '^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$',
  eventId: '^franchise\\.application_submitted:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  place: "^(?=.*\\p{L})(?!.*\\.[\\p{L}\\p{M}]{2})[\\p{L}\\p{M} .,'’()-]+$",
};
const RX = {
  code: new RegExp(PATTERNS.code),
  verifier: new RegExp(PATTERNS.codeVerifier),
  totp: new RegExp(PATTERNS.totp),
  recovery: new RegExp(PATTERNS.recoveryCode),
  eventId: new RegExp(PATTERNS.eventId),
  place: new RegExp(PATTERNS.place, 'u'),
  random43: /^[A-Za-z0-9_-]{43}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest();
function same(a, b) {
  const x = sha256(String(a));
  const y = sha256(String(b));
  return timingSafeEqual(x, y);
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadFixtures(path) {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  return { users: f.users, totpRoles: new Set(f.totpRoles) };
}

export function createMock({ env = process.env, now = () => Date.now(), fixturesPath } = {}) {
  const fixtures = loadFixtures(fixturesPath ?? fileURLToPath(new URL('./fixtures.json', import.meta.url)));
  const aiWeb = new URL(env.MOCK_AI_WEB_URL || 'http://localhost:3000').origin;
  const returnUrl = `${aiWeb}/masuk/callback`;
  const secure = aiWeb.startsWith('https:');
  const ingressUrl = env.MOCK_INGRESS_URL || 'http://aiweb:3000/api/ingress/hd';

  const privateKey = env.MOCK_SIGNING_KEY
    ? createPrivateKey({ key: Buffer.from(env.MOCK_SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' })
    : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  // RFC 7638 thumbprint: the same key always gets the same kid.
  const kid = b64u(sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })));
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, use: 'sig', alg: 'ES256' };
  // The second-factor ticket's MAC key: derived from the signing key, never stored.
  const ticketKey = createHmac('sha256', 'mock-ticket').update(privateKey.export({ format: 'der', type: 'pkcs8' })).digest();

  const state = {
    killed: false,
    codes: new Map(), // code -> { challenge, user, exp, kept }
    fails: new Map(), // user id -> { n, lockedUntil }
    notified: new Map(), // lower-case eventId -> notification id
    calls: fresh(),
    lastEvent: null,
  };
  function fresh() {
    return { tokens: 0, refusedTokens: 0, handoffs: 0, notifications: [], refusedNotifications: 0, alerts: [] };
  }

  function jwt(claims, ttl = TOKEN_TTL_S) {
    const t = Math.floor(now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
    const body = b64u(JSON.stringify({ iss: 'hydromart-auth', nbf: t, iat: t, exp: t + ttl, ...claims }));
    const sig = signBytes('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `${head}.${body}.${b64u(sig)}`;
  }
  function readJwt(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    try {
      const sig = Buffer.from(parts[2], 'base64url');
      const ok = sig.length === 64 &&
        verifySignature('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig);
      return ok ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) : null;
    } catch {
      return null;
    }
  }
  const ticketMac = (userId, exp) => b64u(createHmac('sha256', ticketKey).update(`${userId}.${exp}`).digest());
  function makeTicket(userId) {
    const exp = Math.floor(now() / 1000) + TICKET_TTL_S;
    return `${exp}.${ticketMac(userId, exp)}`;
  }
  function ticketOk(userId, ticket) {
    if (typeof ticket !== 'string' || ticket.length > 100) return false;
    const m = /^([0-9]+)[.]([A-Za-z0-9_-]+)$/.exec(ticket);
    if (!m || Number(m[1]) * 1000 <= now()) return false;
    return same(m[2], ticketMac(userId, m[1]));
  }

  const errorBody = (statusCode, code, message, details) => ({ statusCode, code, message, ...(details ? { details } : {}) });

  function issueCode(user, challenge) {
    const code = randomBytes(32).toString('base64url');
    for (const [c, v] of state.codes) if (v.exp < now()) state.codes.delete(c);
    setBounded(state.codes, code, { challenge, user, exp: now() + CODE_TTL_MS, kept: false }, MAX_CODES);
    return code;
  }

  // ------------------------------------------------------------------ handoff/token
  function handoff(body) {
    state.calls.handoffs += 1;
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const { code, codeVerifier, totp, recoveryCode, secondFactorTicket } = b;
    const bad =
      typeof code !== 'string' || !RX.code.test(code) ||
      typeof codeVerifier !== 'string' || !RX.verifier.test(codeVerifier) ||
      (totp !== undefined && (typeof totp !== 'string' || !RX.totp.test(totp))) ||
      (recoveryCode !== undefined && (typeof recoveryCode !== 'string' || !RX.recovery.test(recoveryCode))) ||
      (secondFactorTicket !== undefined && (typeof secondFactorTicket !== 'string' || secondFactorTicket.length > 100));
    if (bad) return [400, errorBody(400, 'VALIDATION_ERROR', 'The request body is not what the contract asks for')];
    if (state.killed) return [503, errorBody(503, 'AUTH_EXTERNAL_TOKENS_OFF', 'AI web tokens are switched off')];

    const entry = state.codes.get(code);
    const invalid = [401, errorBody(401, 'AUTH_HANDOFF_INVALID', 'Unknown, used or expired code, or the wrong verifier')];
    if (!entry || entry.exp <= now()) {
      state.codes.delete(code);
      return invalid;
    }
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    if (!same(challenge, entry.challenge)) {
      state.codes.delete(code); // spent, right verifier or wrong
      return invalid;
    }
    const user = entry.user;
    if (user.role === 'CUSTOMER') {
      state.codes.delete(code);
      return [403, errorBody(403, 'AUTH_HANDOFF_STAFF_ONLY', 'The AI web is for staff')];
    }
    if (user.suspended) {
      state.codes.delete(code);
      return [403, errorBody(403, 'AUTH_ACCOUNT_SUSPENDED', 'This account is suspended')];
    }
    let ticket = null;
    if (fixtures.totpRoles.has(user.role)) {
      if (user.enrolmentRequired) {
        state.codes.delete(code);
        return [403, errorBody(403, 'AUTH_TOTP_ENROLMENT_REQUIRED', 'Set up an authenticator first')];
      }
      const fail = state.fails.get(user.id) ?? { n: 0, lockedUntil: 0 };
      if (fail.lockedUntil > now()) {
        state.codes.delete(code);
        return [429, errorBody(429, 'AUTH_TOTP_LOCKED', 'Too many wrong codes', { retryAfterSeconds: Math.ceil((fail.lockedUntil - now()) / 1000) })];
      }
      if (!ticketOk(user.id, secondFactorTicket)) {
        if (totp === undefined && recoveryCode === undefined) {
          if (!entry.kept) {
            entry.kept = true;
            entry.exp = now() + KEPT_TTL_MS; // once, for 60 more seconds
          }
          return [401, errorBody(401, 'AUTH_TOTP_REQUIRED', 'The second factor is missing')];
        }
        state.codes.delete(code);
        if (totp === TOTP_CODE || recoveryCode === RECOVERY_CODE) {
          state.fails.delete(user.id);
          ticket = makeTicket(user.id);
        } else {
          fail.n += 1;
          if (fail.n >= LOCK_AFTER) {
            fail.n = 0;
            fail.lockedUntil = now() + LOCK_S * 1000;
          }
          setBounded(state.fails, user.id, fail);
          return [422, errorBody(422, 'AUTH_TOTP_INVALID', 'Wrong or used authenticator code')];
        }
      }
    }
    state.codes.delete(code);
    const token = jwt({ aud: 'hydromart-ai', sub: user.id, role: user.role, depotId: user.depotId ?? null });
    return [200, {
      tokenType: 'Bearer',
      accessToken: token,
      expiresIn: TOKEN_TTL_S,
      ...(ticket ? { secondFactorTicket: ticket, secondFactorTicketExpiresIn: TICKET_TTL_S } : {}),
    }];
  }

  // ----------------------------------------------------------------- machine + notification
  function machineToken(body) {
    if (state.killed) return [503, errorBody(503, 'AUTH_EXTERNAL_TOKENS_OFF', 'Switched off')];
    const ok =
      env.MOCK_MACHINE_ID && env.MOCK_MACHINE_SECRET &&
      typeof body?.accountId === 'string' && typeof body?.secret === 'string' &&
      same(body.accountId, env.MOCK_MACHINE_ID) && same(body.secret, env.MOCK_MACHINE_SECRET);
    if (!ok) {
      state.calls.refusedTokens += 1;
      return [401, { message: 'Unknown account, wrong secret, or a secret past its day' }];
    }
    state.calls.tokens += 1;
    return [200, {
      tokenType: 'Bearer',
      accessToken: jwt({ aud: 'hydromart-machine', sub: env.MOCK_MACHINE_ID, scopes: ['franchiseApplicationNotify', 'morningSummaryNotify'] }),
      expiresIn: TOKEN_TTL_S,
    }];
  }

  function machineAllowed(req, scope) {
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const claims = auth ? readJwt(auth[1]) : null;
    const t = now() / 1000;
    if (!claims || claims.aud !== 'hydromart-machine' || !(claims.exp > t) ||
      !Array.isArray(claims.scopes) || !claims.scopes.includes(scope)) {
      state.calls.refusedNotifications += 1;
      return false;
    }
    return true;
  }
  const refusedToken = () => [401, errorBody(401, 'UNAUTHORIZED', 'Invalid or expired access token.')];

  // AI-9's 07.00 WIB summary: the body is exactly today's eventId + date (Asia/Jakarta). The answer is
  // the real route's shape with every count zero: staging has no people to notify.
  function morningSummary(req, body) {
    if (!machineAllowed(req, 'morningSummaryNotify')) return refusedToken();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now());
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (Object.keys(b).sort().join(',') !== 'date,eventId' || b.date !== today || b.eventId !== `morning-summary:${today}`) {
      return [400, errorBody(400, 'VALIDATION_ERROR', ['The notification is not what the contract asks for'])];
    }
    keep(state.calls.notifications, {
      workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
      eventId: b.eventId, city: null, province: null,
    });
    return [200, { date: today, recipients: 0, notified: 0, nothingWaiting: 0, whatsapp: 'pending' }];
  }

  function notification(req, body) {
    if (!machineAllowed(req, 'franchiseApplicationNotify')) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const keys = Object.keys(b).sort().join(',');
    const idPart = typeof b.eventId === 'string' ? b.eventId.split(':')[1] : '';
    const valid =
      keys === 'applicationId,city,eventId,province' &&
      typeof b.eventId === 'string' && RX.eventId.test(b.eventId.toLowerCase()) &&
      typeof b.applicationId === 'string' && RX.uuid.test(b.applicationId) &&
      b.applicationId.toLowerCase() === idPart.toLowerCase() &&
      [b.city, b.province].every((v) => typeof v === 'string' && v.length >= 1 && v.length <= 100 && RX.place.test(v));
    if (!valid) return [400, errorBody(400, 'VALIDATION_ERROR', ['The notification is not what the contract asks for'])];
    if (b.city === 'GAGAL') return [500, errorBody(500, 'SERVICE_UNAVAILABLE', 'simulated failure')];
    const key = b.eventId.toLowerCase();
    let id = state.notified.get(key);
    if (!id) {
      id = randomUUID();
      setBounded(state.notified, key, id);
      keep(state.calls.notifications, {
        workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
        eventId: b.eventId, city: b.city, province: b.province,
      });
    }
    return [200, { id }];
  }
  // -------------------------------------------------------------------------- pages
  const page = (title, inner) =>
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title>` +
    `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}button{font:inherit;padding:.4rem .8rem;margin:.2rem 0;cursor:pointer}` +
    `li{list-style:none}pre{background:#f4f4f4;padding:.6rem;overflow:auto}</style></head><body>${inner}</body></html>`;

  function handoffParams(q) {
    const challenge = q.get('challenge') ?? '';
    const st = q.get('state') ?? '';
    const ret = q.get('return') ?? '';
    if (!RX.random43.test(challenge) || !RX.random43.test(st)) return null;
    if (ret !== returnUrl) return null;
    return { challenge, state: st, ret };
  }
  const refuse = (res, text) => send(res, 400, page('Ditolak', `<h1>Ditolak</h1><p>${esc(text)}</p>`), 'text/html; charset=utf-8');

  function continueTo(res, params, user) {
    const code = issueCode(user, params.challenge);
    const to = new URL(params.ret);
    to.search = new URLSearchParams({ code, state: params.state }).toString();
    res.writeHead(303, {
      location: to.toString(),
      'set-cookie': `mock_user=${user.id}; Path=/ai; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    res.end();
  }

  function pickerPage(params) {
    const hidden = ['challenge', 'state', 'return']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(k === 'return' ? params.ret : params[k])}">`)
      .join('');
    const rows = fixtures.users
      .map((u) => `<li><button name="user" value="${esc(u.id)}">${esc(u.name)}</button> <small>${esc(u.role)}</small></li>`)
      .join('');
    return page('Staging: pilih orang',
      `<h1>Hydromart palsu (staging)</h1><p>Pilih orang rekaan untuk masuk ke Web AI. Tidak ada data asli di sini.</p>` +
      `<p>Peran ${[...fixtures.totpRoles].map(esc).join(', ')} meminta kode autentikator: <b>${TOTP_CODE}</b>` +
      ` (kode pemulihan <b>${RECOVERY_CODE}</b>).</p><form method="post" action="/ai/masuk">${hidden}<ul>${rows}</ul></form>`);
  }

  function consolePage() {
    const c = state.calls;
    return page('Staging: hydromart palsu',
      `<h1>Hydromart palsu (staging)</h1>` +
      `<p>Token AI: <b>${state.killed ? 'MATI (saklar)' : 'hidup'}</b></p>` +
      `<form method="post" action="/_mock/kill"><button>${state.killed ? 'Hidupkan lagi' : 'Matikan token AI'}</button></form>` +
      `<form method="post" action="/_mock/event"><label>Kota <input name="city" value="Bekasi" maxlength="100"></label> ` +
      `<button>Kirim peristiwa lamaran waralaba (bertanda tangan)</button></form>` +
      `<p>Terakhir: ${state.lastEvent ? esc(JSON.stringify(state.lastEvent)) : 'belum ada'}</p>` +
      `<form method="post" action="/_mock/reset"><button>Kosongkan catatan dan kode</button></form>` +
      `<h2>Panggilan</h2><pre>${esc(JSON.stringify({ ...c, notifications: c.notifications.length, alerts: c.alerts.length }, null, 2))}</pre>` +
      `<p><a href="/_mock/calls">Rincian (JSON)</a></p>`);
  }

  async function sendEvent(city) {
    const applicationId = randomUUID();
    const event = {
      id: randomUUID(),
      event: 'franchise.application_submitted',
      occurredAt: new Date(now()).toISOString(),
      eventId: `franchise.application_submitted:${applicationId}`,
      data: { applicationId, city, province: 'Jawa Barat' },
    };
    const raw = JSON.stringify(event);
    const ts = String(Math.floor(now() / 1000));
    const secret = env.MOCK_HD_EVENT_SECRET;
    if (!secret) return { sent: false, why: 'MOCK_HD_EVENT_SECRET is not set' };
    const signature = signEvent(secret, ts, raw);
    try {
      const r = await fetch(ingressUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hydromart-event': event.event,
          'x-hydromart-delivery': event.id,
          'x-hydromart-timestamp': ts,
          'x-hydromart-signature': signature,
        },
        body: raw,
        signal: AbortSignal.timeout(10_000),
      });
      return { sent: true, status: r.status, eventId: event.eventId };
    } catch (error) {
      return { sent: false, why: String(error?.cause?.code ?? error?.name ?? 'error') };
    }
  }

  // ------------------------------------------------------------------------ server
  function send(res, status, body, type = 'application/json') {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const html = type.startsWith('text/html') ? { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' } : {};
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...html });
    res.end(text);
  }
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) resolve(null);
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  const parseJson = (raw) => {
    try {
      return raw === '' ? {} : JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const cookieOf = (req, name) => new RegExp(`(?:^|; )${name}=([^;]*)`).exec(req.headers.cookie ?? '')?.[1];

  // Browsers send the login wall's credentials by themselves, so a page on any other site could
  // post to the console. Refused when the browser says the request is cross-site (Sec-Fetch-Site)
  // or names another origin; a request with neither header (curl, the servers) is not a browser.
  function crossSite(req) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return true;
    const origin = req.headers.origin;
    if (origin === undefined) return false;
    try {
      return new URL(origin).host !== req.headers.host;
    } catch {
      return true;
    }
  }

  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    const post = req.method === 'POST';
    const raw = post ? await readBody(req) : '';
    if (raw === null) {
      res.writeHead(413, { 'content-type': 'application/json', connection: 'close' });
      return res.end(JSON.stringify(errorBody(413, 'PAYLOAD_TOO_LARGE', 'Too large')), () => req.destroy());
    }
    if (post && (path.startsWith('/_mock/') || path === '/ai/masuk') && crossSite(req)) {
      return send(res, 403, errorBody(403, 'FORBIDDEN', 'Cross-site request refused'));
    }
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });

      if (req.method === 'GET' && path === '/auth/api/v1/auth/jwks') {
        return send(res, 200, { keys: state.killed ? [] : [publicJwk] });
      }
      if (post && path === '/auth/api/v1/auth/handoff/token') {
        const [status, body] = handoff(parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/auth/api/v1/auth/machine/token') {
        const [status, body] = machineToken(parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/franchise-application-submitted') {
        const [status, body] = notification(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/morning-summary') {
        const [status, body] = morningSummary(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/alert') {
        const alert = parseJson(raw);
        keep(state.calls.alerts, { size: raw.length, keys: alert && typeof alert === 'object' ? Object.keys(alert).slice(0, 5) : [] });
        return send(res, 204);
      }

      if (req.method === 'GET' && path === '/ai/masuk') {
        const params = handoffParams(url.searchParams);
        if (!params) return refuse(res, 'Tautan masuk tidak sah: tantangan, status atau alamat kembali salah.');
        const known = fixtures.users.find((u) => u.id === cookieOf(req, 'mock_user'));
        let fromAiWeb = false;
        try {
          fromAiWeb = new URL(req.headers.referer ?? '').origin === aiWeb;
        } catch {
          // no referrer: show the picker
        }
        if (known && fromAiWeb && url.searchParams.get('pick') !== '1') return continueTo(res, params, known);
        return send(res, 200, pickerPage(params), 'text/html; charset=utf-8');
      }
      if (post && path === '/ai/masuk') {
        const form = new URLSearchParams(raw);
        const params = handoffParams(form);
        const user = fixtures.users.find((u) => u.id === form.get('user'));
        if (!params || !user) return refuse(res, 'Pilihan tidak sah.');
        return continueTo(res, params, user);
      }

      if (req.method === 'GET' && (path === '/_mock' || path === '/_mock/')) {
        return send(res, 200, consolePage(), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && path === '/_mock/calls') return send(res, 200, { killed: state.killed, ...state.calls });
      if (post && path === '/_mock/kill') {
        state.killed = !state.killed;
        res.writeHead(303, { location: '/_mock/' });
        return res.end();
      }
      if (post && path === '/_mock/reset') {
        state.codes.clear();
        state.fails.clear();
        state.notified.clear();
        state.calls = fresh();
        state.lastEvent = null;
        res.writeHead(303, { location: '/_mock/' });
        return res.end();
      }
      if (post && path === '/_mock/event') {
        const city = new URLSearchParams(raw).get('city') || 'Bekasi';
        state.lastEvent = await sendEvent(city.slice(0, 100));
        res.writeHead(303, { location: '/_mock/' });
        return res.end();
      }
      return send(res, 404, errorBody(404, 'NOT_FOUND', 'not here'));
    } catch (error) {
      console.error(`mock: ${error?.message ?? error}`);
      return send(res, 500, errorBody(500, 'SERVICE_UNAVAILABLE', 'mock error'));
    }
  });

  return { server, state, jwk: publicJwk, returnUrl };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.MOCK_PORT || 9911);
  const { server } = createMock();
  server.listen(port, () => console.log(`hydromart mock listening on ${port}`));
}
