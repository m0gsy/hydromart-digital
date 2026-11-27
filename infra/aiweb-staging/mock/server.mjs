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
//   POST /crm/api/v1/notifications/external/ai-access-requested   n8n's "Minta akses" notification
//   POST /crm/api/v1/notifications/external/customer-reminders   n8n's customer reminders (HD-18)
//   POST /crm/api/v1/notifications/external/maintenance-due   n8n's 07.30 WIB maintenance sweep (HD-15)
//   POST /crm/api/v1/notifications/external/compliance-due   n8n's 07.30 WIB permit and lab-test sweep (HD-14)
//   POST /crm/api/v1/notifications/external/quality-hold   n8n's relay of a depot quality hold event (HD-14)
//   POST /crm/api/v1/notifications/external/sales-weekly-ready   n8n's Monday weekly Sales report trigger (AI-26)
//   POST /crm/api/v1/notifications/external/ai-agent-notice   n8n's relay of an AI agent event (AI-31)
//   GET  /dashboard/api/v1/ai/read/scope|money|gallons|customers|targets   the read API: made-up numbers
//                                       derived from the date; a depot-bound person sees one depot
//   GET  /dashboard/api/v1/dashboard/pending-approvals   the queues a person decides
//   GET  /depot/api/v1/ai/crm/legacy-applications , /auth/api/v1/ai/crm/pic-candidates   fake applicants and PIC candidates (HD-21)
//   GET  /depot/api/v1/ai/team/access   the Tim AI screen's access read (AI-29)
//   GET  /depot/api/v1/ai/crm/access , POST|GET /depot/api/v1/ai/drafts/depots/from-crm[/:prospectId]
//                                       the CRM calon mitra's access read and depot draft (HD-21a)
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
  accessEventId: /^ai-access-request:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  random43:/^[A-Za-z0-9_-]{43}$/,
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

// ---------------------------------------------------------------------------- read API numbers
// Made up and deterministic: a depot's value on a day is its base, times a weekday factor, times
// 1 + trend * a wave of the week number (period 5). Yesterday and the four same weekdays before it
// are five consecutive weeks, so they meet five different wave values and yesterday is never exactly
// "usual": a depot with a positive trend and one with a negative trend land on opposite sides.
const DAY_MS = 86_400_000;
const WEEKDAY = [0.9, 0.95, 1, 1.05, 1.2, 1.4, 1.1]; // Monday first
const WAVE = [0, 3, -2, 1, -1];
const dayNo = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const validDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(dayNo(s)) === s;
const dayValue = (depot, metric, n) =>
  Math.round(depot.base[metric] * WEEKDAY[(n + 3) % 7] * (1 + depot.trend * WAVE[Math.floor(n / 7) % 5]));
/** First and last day number of the whole calendar period (WIB dates, so plain calendar maths). */
function bounds(unit, date) {
  const n = dayNo(date);
  const d = new Date(n * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (unit === 'day') return [n, n];
  if (unit === 'week') return [n - ((n + 3) % 7), n - ((n + 3) % 7) + 6];
  if (unit === 'month') return [Date.UTC(y, m, 1) / DAY_MS, Date.UTC(y, m + 1, 0) / DAY_MS];
  return [Date.UTC(y, 0, 1) / DAY_MS, Date.UTC(y, 11, 31) / DAY_MS];
}
// What each read route serves: metric -> unit, as the contract's x-metrics names it.
const READ = {
  money: { 'P-01': 'Rp', 'P-07': 'pesanan' },
  gallons: { 'G-01': 'galon' },
  customers: { 'C-01': 'orang' },
  targets: { 'T-01': 'Rp', 'T-02': 'galon', 'T-03': 'pesanan' },
};
// A target metric and the metric that measures it (T-03 is P-07 here: the mock has no P-04).
const TARGET_BASE = { 'T-01': 'P-01', 'T-02': 'G-01', 'T-03': 'P-07' };
const READ_UNITS = new Set(['day', 'week', 'month', 'year']);
const ACCESS_GROUPS = ['scope', 'money', 'stock', 'loyalty', 'franchise', 'hr', 'customers', 'delivery', 'gallons'];
const ACCESS_KEYS = new Set(['eventId', 'requesterAccountId', 'legalEntityIds', 'group']);
const MACHINE_SCOPES = [
  'franchiseApplicationNotify', 'morningSummaryNotify', 'aiAccessRequestNotify', 'customerReminderNotify', 'maintenanceDueNotify',
  'salesReportNotify', 'aiAgentNotify', 'complianceDueNotify', 'qualityHoldNotify',
];
export const AGENT_NOTICE_KINDS = ['FLAG', 'CAP_REACHED', 'STOPPED', 'STOPPED_ALL'];
export const REMINDER_KINDS = ['SUBSCRIPTION_TOMORROW', 'POINTS_EXPIRING', 'UNPAID_ORDER'];
const ACCESS_PER_REQUESTER = 3;
const ACCESS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

function loadFixtures(path) {
  const f = JSON.parse(readFileSync(path, 'utf8'));
  return { users: f.users, depots: f.depots, totpRoles: new Set(f.totpRoles) };
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
    accessAsks: new Map(), // lower-case ai-access-requested eventId -> { requester, at }
    crmDrafts: new Map(), // lower-case prospectId -> the depot draft (HD-21a)
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
      accessToken: jwt({ aud: 'hydromart-machine', sub: env.MOCK_MACHINE_ID, scopes: MACHINE_SCOPES }),
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

  // HD-18's customer reminders and HD-15's maintenance sweep: n8n only says "now", with today's
  // Jakarta date (and, for reminders, the kind). The answers are the real routes' shapes with every
  // count zero: staging has no customers and no depots to remind.
  function trigger(req, body, scope, keys, answer) {
    if (!machineAllowed(req, scope)) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (Object.keys(b).sort().join(',') !== keys || b.date !== todayWib() ||
      (b.kind !== undefined && !REMINDER_KINDS.includes(b.kind))) {
      return [400, errorBody(400, 'VALIDATION_ERROR', ['The trigger is not what the contract asks for'])];
    }
    keep(state.calls.notifications, {
      workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
      eventId: [scope, b.kind, b.date].filter(Boolean).join(':'), city: null, province: null,
    });
    return [200, { ...b, ...answer, whatsapp: 'pending' }];
  }
  const customerReminders = (req, body) =>
    trigger(req, body, 'customerReminderNotify', 'date,kind', { candidates: 0, truncated: false, notified: 0, skipped: 0 });
  const maintenanceDue = (req, body) =>
    trigger(req, body, 'maintenanceDueNotify', 'date', { depots: 0, items: 0, notified: 0, remindLater: 0 });

  const complianceDue = (req, body) =>
    trigger(req, body, 'complianceDueNotify', 'date', { depots: 0, items: 0, notified: 0, remindLater: 0 });

  // HD-14's relay of depot.quality_hold_changed (QualityHoldTrigger). The mock keeps no hold state, so a
  // well-formed event is "stale" (the depot is not on hold here): 200, nobody told, do not retry.
  function qualityHold(req, body) {
    if (!machineAllowed(req, 'qualityHoldNotify')) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const valid =
      Object.keys(b).sort().join(',') === 'changedAt,holdDepotId,status' &&
      typeof b.holdDepotId === 'string' && RX.uuid.test(b.holdDepotId) &&
      ['ACTIVE', 'ENDED'].includes(b.status) &&
      typeof b.changedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(b.changedAt) && !Number.isNaN(Date.parse(b.changedAt));
    if (!valid) return [400, errorBody(400, 'VALIDATION_ERROR', ['The notification is not what the contract asks for'])];
    keep(state.calls.notifications, {
      workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
      eventId: `quality-hold:${b.holdDepotId}:${b.status}:${b.changedAt}`, city: null, province: null,
    });
    return [200, { notified: 0, stale: true }];
  }

  // AI-26's Monday trigger: ids only. eventId is sales-weekly:<weekStart>; weekStart a real Monday that is
  // 7 to 13 days back (the week that just ended, accepted until its own Sunday), as the real weekRefusal.
  // Staging has no staff to notify: the real shape with every count zero (an id is "unknown": no legal
  // entity is modelled here).
  function salesWeeklyReady(req, body) {
    if (!machineAllowed(req, 'salesReportNotify')) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const ids = b.legalEntityIds;
    const valid =
      Object.keys(b).sort().join(',') === 'eventId,legalEntityIds,weekStart' &&
      typeof b.weekStart === 'string' && validDay(b.weekStart) && b.eventId === `sales-weekly:${b.weekStart}` &&
      Array.isArray(ids) && ids.length >= 1 && ids.length <= 50 &&
      ids.every((i) => typeof i === 'string' && RX.uuid.test(i)) &&
      new Set(ids.map((i) => i.toLowerCase())).size === ids.length;
    if (!valid) return [400, errorBody(400, 'VALIDATION_ERROR', ['The trigger is not what the contract asks for'])];
    const since = dayNo(todayWib()) - dayNo(b.weekStart);
    if (((dayNo(b.weekStart) % 7) + 7) % 7 !== 4) return [400, errorBody(400, 'BAD_REQUEST', 'weekStart must be a Monday')];
    if (since < 7 || since > 13) return [400, errorBody(400, 'BAD_REQUEST', 'weekStart must be the week that just ended (Asia/Jakarta)')];
    keep(state.calls.notifications, {
      workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
      eventId: b.eventId, city: null, province: null,
    });
    return [200, { weekStart: b.weekStart, legalEntities: 0, unknownEntities: ids.length, inactiveEntities: 0, recipients: 0, notified: 0, whatsapp: 'pending' }];
  }

  // AI-31's relay of an agent event: ids and a kind only (AiAgentNoticeTrigger). Nobody to tell in staging.
  function aiAgentNotice(req, body) {
    if (!machineAllowed(req, 'aiAgentNotify')) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const valid =
      Object.keys(b).every((k) => ['eventId', 'agentId', 'agentName', 'kind', 'bossRole'].includes(k)) &&
      typeof b.eventId === 'string' && /^[A-Za-z0-9:._-]{1,120}$/.test(b.eventId) &&
      typeof b.agentId === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(b.agentId) &&
      typeof b.agentName === 'string' && b.agentName.length >= 1 && b.agentName.length <= 40 && /^[\p{L}\p{N} ]+$/u.test(b.agentName) &&
      AGENT_NOTICE_KINDS.includes(b.kind) &&
      (b.bossRole === undefined || (typeof b.bossRole === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(b.bossRole)));
    if (!valid) return [400, errorBody(400, 'VALIDATION_ERROR', ['The notification is not what the contract asks for'])];
    keep(state.calls.notifications, {
      workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
      eventId: b.eventId, city: null, province: null,
    });
    return [200, { recipients: 0, notified: 0, whatsapp: 'pending' }];
  }

  // "Minta akses": ids only (contract AiAccessRequestedNotify). A requester that is a fixture person
  // who cannot grant access counts toward the caps (3 distinct eventIds per requester, 30 overall,
  // rolling hour); anyone else is "unknown": 200, nobody told, not counted.
  function accessRequested(req, body) {
    if (!machineAllowed(req, 'aiAccessRequestNotify')) return refusedToken();
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const ids = b.legalEntityIds;
    const valid =
      Object.keys(b).every((k) => ACCESS_KEYS.has(k)) &&
      typeof b.eventId === 'string' && RX.accessEventId.test(b.eventId) &&
      typeof b.requesterAccountId === 'string' && RX.uuid.test(b.requesterAccountId) &&
      (ids === undefined ||
        (Array.isArray(ids) && ids.length <= 20 && ids.every((i) => typeof i === 'string' && RX.uuid.test(i)) &&
          new Set(ids.map((i) => i.toLowerCase())).size === ids.length)) &&
      (b.group === undefined || ACCESS_GROUPS.includes(b.group));
    if (!valid) return [400, errorBody(400, 'VALIDATION_ERROR', ['The notification is not what the contract asks for'])];
    const requester = fixtures.users.find((u) => u.id === b.requesterAccountId.toLowerCase());
    if (!requester || requester.role === 'SUPER_ADMIN') return [200, { recipients: 0, notified: 0, whatsapp: 'pending' }];
    const key = b.eventId.toLowerCase();
    if (!state.accessAsks.has(key)) {
      const recent = [...state.accessAsks.values()].filter((a) => a.at > now() - HOUR_MS);
      if (recent.length >= ACCESS_PER_HOUR || recent.filter((a) => a.requester === requester.id).length >= ACCESS_PER_REQUESTER) {
        return [200, { recipients: 1, notified: 0, whatsapp: 'pending', capped: true }];
      }
      setBounded(state.accessAsks, key, { requester: requester.id, at: now() });
      keep(state.calls.notifications, {
        workflow: String(req.headers['x-workflow'] ?? '').slice(0, 120) || null,
        eventId: b.eventId, city: null, province: null,
      });
    }
    return [200, { recipients: 1, notified: 1, whatsapp: 'pending' }];
  }

  // ------------------------------------------------------------------------- the read API
  // The person's own token (aud hydromart-ai). A franchise owner holds no aiRead (the default) and a
  // machine token is not a person's: both 403. A depot-bound person (depotId claim) reads that depot.
  function reader(req) {
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const claims = auth ? readJwt(auth[1]) : null;
    if (!claims || state.killed || !(claims.exp > now() / 1000)) return { fail: refusedToken() };
    if (claims.aud !== 'hydromart-ai' || claims.role === 'FRANCHISE_OWNER') {
      return { fail: [403, errorBody(403, 'FORBIDDEN', 'This token may not read this.')] };
    }
    return { depots: claims.depotId ? fixtures.depots.filter((d) => d.id === claims.depotId) : fixtures.depots };
  }
  const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now());

  function envelope(depots, unit, date, over) {
    const [from, to] = bounds(unit, date);
    const wib = (n) => new Date(Date.parse(`${isoOf(n)}T00:00:00+07:00`)).toISOString();
    return {
      period: { unit, from: isoOf(from), to: isoOf(to), timeZone: 'Asia/Jakarta', fromAt: wib(from), toAt: wib(to + 1) },
      scope: { depotIds: depots.map((d) => d.id), legalEntityIds: [] },
      status: 'ok',
      asOf: new Date(now()).toISOString(),
      ...over,
    };
  }

  function readRoute(req, group, q) {
    const who = reader(req);
    if (who.fail) return who.fail;
    const bad = (m) => [400, errorBody(400, 'BAD_REQUEST', m)];
    const unit = q.get('period') ?? 'day';
    const date = q.get('date') ?? todayWib();
    if (!READ_UNITS.has(unit) || !validDay(date)) return bad('period must be day, week, month or year, and date a real day');
    const { depots } = who;
    if (group === 'scope') {
      if (q.get('split')) return bad('scope cannot be split');
      return [200, envelope(depots, unit, date, {
        metricId: 'meta.scope', value: depots.length, unit: 'depot',
        depots: depots.map((d) => ({ depotId: d.id, code: d.code, label: d.label })),
      })];
    }
    const metric = q.get('metric');
    if (!metric) return bad('metric is required');
    const unitName = READ[group][metric];
    if (!unitName) return [404, errorBody(404, 'NOT_FOUND', 'Not a metric of this group (staging answers P-01, P-07, G-01, C-01 and T-01 to T-03).')];
    const split = q.get('split');
    if (split !== null && (split !== 'depot' || group === 'customers')) return bad('this metric cannot be split like that');
    if (metric === 'C-01' && unit !== 'month') return bad('C-01 is a whole month');
    if (group === 'targets') return targetRoute(depots, metric, unit, date, split, bad);
    const [from, to] = bounds(unit, date);
    const sum = (d) => {
      let t = 0;
      for (let n = from; n <= to; n += 1) t += dayValue(d, metric, n);
      return t;
    };
    const byDepot = depots.map((d) => ({ depotId: d.id, value: sum(d) }));
    const total = byDepot.reduce((a, v) => a + v.value, 0);
    return [200, envelope(depots, unit, date, { metricId: metric, value: split ? { total, byDepot } : total, unit: unitName })];
  }

  // T-01..T-03: one whole month. actual = the base metric's sums, up to today for the running month
  // (a pace, as the real route answers it); target is the depot's fixed figure, null where it has none.
  function targetRoute(depots, metric, unit, date, split, bad) {
    if (unit !== 'month') return bad(`${metric} is a whole month`);
    const [from, last] = bounds('month', date);
    // The running month's actual stops at today, as the real route's does ("sampai hari ini"); the mock's own
    // P-01 month answer is the whole month, which is fine for staging. A future month sums nothing: actual 0,
    // pct 0, like the real route (its scope runs to the period's end and the base metric has no orders).
    const to = Math.min(last, dayNo(todayWib()));
    const base = TARGET_BASE[metric];
    const cell = (actual, target) => ({ target, actual, pct: target === null ? null : Math.round((actual / target) * 1000) / 10 });
    const rows = depots.map((d) => {
      let actual = 0;
      for (let n = from; n <= to; n += 1) actual += dayValue(d, base, n);
      return { depotId: d.id, ...cell(actual, d.target?.[metric] ?? null) };
    });
    const actual = rows.reduce((a, r) => a + r.actual, 0);
    const every = rows.every((r) => r.target !== null);
    const target = every ? rows.reduce((a, r) => a + r.target, 0) : null;
    const out = { metricId: metric, unit: READ.targets[metric] };
    const none = (reason) => [200, envelope(depots, unit, date, { ...out, value: null, status: 'belum_ada', reason })];
    // As the real route: no depot with a target is belum_ada even when split by depot.
    if (rows.every((r) => r.target === null)) return none('Belum ada target bulan ini untuk depot yang boleh Anda baca; tidak dibandingkan dengan 0.');
    if (!split && !every) {
      return none('Belum ada target bulan ini untuk setiap depot yang boleh Anda baca; angka jaringan tidak dibandingkan dengan target yang tidak lengkap.');
    }
    const value = split ? { ...cell(actual, target), byDepot: rows } : cell(actual, target);
    return [200, envelope(depots, unit, date, { ...out, value })];
  }

  // The queues a person decides: three for an HQ person, two for a depot-bound one. Counts are
  // fixed; the oldest item is a fixed number of hours old at the moment of asking.
  function pendingApprovals(req) {
    const who = reader(req);
    if (who.fail) return who.fail;
    const ago = (h) => new Date(now() - h * HOUR_MS).toISOString();
    return [200, { queues: [
      ...(who.depots.length > 1 ? [{ key: 'priceOverrides', count: 3, oldestAt: ago(52), href: '/hq/pricing' }] : []),
      { key: 'leave', count: 2, oldestAt: ago(30), href: '/hr/leave' },
      { key: 'kasbon', count: 0, oldestAt: null, href: '/hr/kasbon' },
    ] }];
  }

  // ------------------------------------------------------------------ CRM calon mitra (HD-21a)
  // Staging does not model the capability matrix: any person who may enter the CRM (the four
  // roles that hold prospectRead built in) is answered full and settings, and may draft. The
  // D1 checks and the one-row-per-prospect rules are the real ones (drafts.openapi.json).
  // SALES_LEAD stands for a custom role that holds prospectSettings (the weekly Sales report's readers).
  const CRM_ROLES = new Set(['MARKETING', 'DIREKTUR', 'HEAD_OFFICE', 'SUPER_ADMIN', 'SALES_LEAD']);
  const CHECKLIST_KEYS = ['ktpNpwp', 'locationProof', 'capitalDeposit', 'fieldSurvey'];
  const CHECKLIST_STATES = new Set(['NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED']);
  const CRM_KEYS = ['prospectId', 'legacyApplicationId', 'proposedName', 'city', 'province', 'owner', 'prospectusHandedOn', 'prospectusSha256', 'prospectusVersionLabel', 'prospectusReceipt', 'agreementSignedOn', 'checklist'];

  function crmPerson(req) {
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const claims = auth ? readJwt(auth[1]) : null;
    if (!claims || state.killed || !(claims.exp > now() / 1000)) return { fail: refusedToken() };
    if (claims.aud !== 'hydromart-ai' || !CRM_ROLES.has(claims.role)) {
      return { fail: [403, errorBody(403, 'FORBIDDEN', 'You do not have permission to perform this action.')] };
    }
    return { claims };
  }

  function crmAccess(req) {
    const who = crmPerson(req);
    if (who.fail) return who.fail;
    return [200, { full: true, settings: true, legalEntities: [{ id: '00000000-0000-4000-8000-000000000001', name: 'PT Contoh Waralaba' }] }];
  }

  // AI-29: the Tim AI screen's access read, with the built-in matrix (staging does not model overrides).
  const TEAM_ROLES = { DIREKTUR: [true, true], SUPER_ADMIN: [true, true], HEAD_OFFICE: [false, true], FINANCE: [false, false], MARKETING: [false, false] };
  function teamAccess(req) {
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    const claims = auth ? readJwt(auth[1]) : null;
    if (!claims || state.killed || !(claims.exp > now() / 1000)) return refusedToken();
    const row = TEAM_ROLES[claims.role];
    if (claims.aud !== 'hydromart-ai' || !row) return [403, errorBody(403, 'FORBIDDEN', 'You do not have permission to perform this action.')];
    return [200, { read: true, manage: row[0], stop: row[1], role: claims.role }];
  }

  // Obviously fake people, the same on every run: the shapes of drafts.openapi.json, nothing real.
  const LEGACY_SAMPLE = [
    { id: '00000000-0000-4000-8000-0000000000f1', stage: 'PENDING', applicantName: 'Calon Contoh Satu', applicantPhoneE164: '+6281200000001', city: 'Bekasi', province: 'Jawa Barat', proposedName: 'Depot Contoh Satu', investmentAmountIdr: 150000000, firstSource: 'contoh-ig', privacyConsentVersion: '2026-11-24', submittedAt: '2026-11-01T03:00:00.000Z' },
    { id: '00000000-0000-4000-8000-0000000000f2', stage: 'SURVEY', applicantName: 'Calon Contoh Dua', applicantPhoneE164: '+6281200000002', city: 'Depok', province: 'Jawa Barat', proposedName: null, investmentAmountIdr: 300000000, firstSource: null, privacyConsentVersion: null, submittedAt: '2026-11-05T03:00:00.000Z' },
  ];
  const PIC_SAMPLE = [
    { id: '00000000-0000-4000-8000-000000000011', fullName: 'Contoh Marketing Satu' },
    { id: '00000000-0000-4000-8000-000000000012', fullName: 'Contoh Marketing Dua' },
  ];

  function crmLegacy(req) {
    const who = crmPerson(req);
    if (who.fail) return who.fail;
    return [200, { applications: LEGACY_SAMPLE, truncated: false }];
  }

  function crmPics(req) {
    const who = crmPerson(req);
    if (who.fail) return who.fail;
    return [200, { people: PIC_SAMPLE }];
  }

  const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
  function crmDraftValid(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    if (Object.keys(b).some((k) => !CRM_KEYS.includes(k))) return false;
    const o = b.owner;
    const c = b.checklist;
    return (
      RX.uuid.test(b.prospectId ?? '') &&
      (b.legacyApplicationId === undefined || b.legacyApplicationId === null || RX.uuid.test(b.legacyApplicationId)) &&
      str(b.proposedName, 3, 80) && str(b.city, 1, 120) && str(b.province, 1, 120) &&
      o && typeof o === 'object' && Object.keys(o).sort().join() === 'fullName,phoneE164' &&
      str(o.fullName, 2, 120) && /^[+]62[0-9]{8,13}$/.test(o.phoneE164 ?? '') &&
      typeof b.prospectusHandedOn === 'string' && validDay(b.prospectusHandedOn) &&
      typeof b.agreementSignedOn === 'string' && validDay(b.agreementSignedOn) &&
      /^[0-9a-f]{64}$/.test(b.prospectusSha256 ?? '') &&
      str(b.prospectusVersionLabel, 1, 40) && str(b.prospectusReceipt, 1, 200) &&
      c && typeof c === 'object' && Object.keys(c).sort().join() === [...CHECKLIST_KEYS].sort().join() &&
      CHECKLIST_KEYS.every((k) => CHECKLIST_STATES.has(c[k]))
    );
  }

  function crmDraft(req, body) {
    const who = crmPerson(req);
    if (who.fail) return who.fail;
    if (!RX.uuid.test(req.headers['x-ai-suggestion-id'] ?? '')) return [400, errorBody(400, 'BAD_REQUEST', 'X-AI-Suggestion-Id must be a UUID.')];
    if (!crmDraftValid(body)) return [400, errorBody(400, 'BAD_REQUEST', ['The draft is not what the contract asks for'])];
    // The header carries the prospect id, in either case.
    if (req.headers['x-ai-suggestion-id'].toLowerCase() !== body.prospectId.toLowerCase()) {
      return [400, errorBody(400, 'BAD_REQUEST', 'X-AI-Suggestion-Id must equal the prospectId of the body.')];
    }
    // The D1 re-check, in the real order: dates (400), checklist (422), cooling-off (422).
    const handed = dayNo(body.prospectusHandedOn);
    const signed = dayNo(body.agreementSignedOn);
    if (signed > dayNo(todayWib())) return [400, errorBody(400, 'INVALID_DRAFT_DATES', 'agreementSignedOn is in the future.')];
    if (handed > signed) return [400, errorBody(400, 'INVALID_DRAFT_DATES', 'prospectusHandedOn is after agreementSignedOn.')];
    const items = CHECKLIST_KEYS.filter((k) => body.checklist[k] !== 'VERIFIED');
    if (items.length) return [422, { ...errorBody(422, 'CHECKLIST_INCOMPLETE', 'Not every checklist item is VERIFIED.'), items }];
    if (signed < handed + 14) {
      return [422, { ...errorBody(422, 'COOLING_OFF_NOT_MET', 'The agreement may not be signed yet.'), earliestOn: isoOf(handed + 14) }];
    }
    const key = body.prospectId.toLowerCase();
    // The same canonical flattening as depot-service's requestHashOf: fixed field order, nested keys in order, ids lower-cased.
    const flat = [
      key, body.legacyApplicationId?.toLowerCase() ?? null, body.proposedName, body.city, body.province,
      body.owner.fullName, body.owner.phoneE164, body.prospectusHandedOn, body.agreementSignedOn,
      body.prospectusSha256, body.prospectusVersionLabel, body.prospectusReceipt,
      ...CHECKLIST_KEYS.map((k) => body.checklist[k]),
    ];
    const hash = createHash('sha256').update(JSON.stringify(flat)).digest('hex');
    const existing = state.crmDrafts.get(key);
    if (existing) {
      if (existing.status === 'ACTIVATED') return [409, { ...errorBody(409, 'ALREADY_ONBOARDED', 'Already a depot.'), depotId: existing.depotId, depotCode: existing.depotCode }];
      if (existing.status === 'DRAFT') {
        if (existing.hash !== hash) return [409, errorBody(409, 'DRAFT_CONFLICT', 'A pending draft has different content.')];
        return [200, { draftId: existing.id, status: 'DRAFT', createdAt: existing.createdAt }];
      }
      Object.assign(existing, { status: 'DRAFT', hash, decisionNote: null, updatedAt: new Date(now()).toISOString() });
      return [201, { draftId: existing.id, status: 'DRAFT', createdAt: existing.createdAt }];
    }
    const at = new Date(now()).toISOString();
    const row = { id: randomUUID(), status: 'DRAFT', hash, decisionNote: null, depotId: null, depotCode: null, createdAt: at, updatedAt: at };
    setBounded(state.crmDrafts, key, row);
    return [201, { draftId: row.id, status: 'DRAFT', createdAt: at }];
  }

  function crmDraftStatus(req, prospectId) {
    const who = crmPerson(req);
    if (who.fail) return who.fail;
    if (!RX.uuid.test(prospectId)) return [400, errorBody(400, 'BAD_REQUEST', 'prospectId must be a UUID.')];
    const row = state.crmDrafts.get(prospectId.toLowerCase());
    if (!row) return [404, errorBody(404, 'DEPOT_DRAFT_NOT_FOUND', 'No depot draft for this prospect.')];
    return [200, { draftId: row.id, status: row.status, decisionNote: row.decisionNote, depotId: row.depotId, depotCode: row.depotCode, updatedAt: row.updatedAt }];
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
      if (post && path === '/crm/api/v1/notifications/external/sales-weekly-ready') {
        const [status, body] = salesWeeklyReady(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/ai-agent-notice') {
        const [status, body] = aiAgentNotice(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/ai-access-requested') {
        const [status, body] = accessRequested(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/customer-reminders') {
        const [status, body] = customerReminders(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/maintenance-due') {
        const [status, body] = maintenanceDue(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/compliance-due') {
        const [status, body] = complianceDue(req, parseJson(raw));
        return send(res, status, body);
      }
      if (post && path === '/crm/api/v1/notifications/external/quality-hold') {
        const [status, body] = qualityHold(req, parseJson(raw));
        return send(res, status, body);
      }
      if (req.method === 'GET' && path.startsWith('/dashboard/api/v1/ai/read/')) {
        const group = path.slice('/dashboard/api/v1/ai/read/'.length);
        if (['scope', 'money', 'gallons', 'customers', 'targets'].includes(group)) {
          const [status, body] = readRoute(req, group, url.searchParams);
          return send(res, status, body);
        }
      }
      if (req.method === 'GET' && path === '/dashboard/api/v1/dashboard/pending-approvals') {
        const [status, body] = pendingApprovals(req);
        return send(res, status, body);
      }
      if (req.method === 'GET' && path === '/depot/api/v1/ai/crm/legacy-applications') {
        const [status, body] = crmLegacy(req);
        return send(res, status, body);
      }
      if (req.method === 'GET' && path === '/auth/api/v1/ai/crm/pic-candidates') {
        const [status, body] = crmPics(req);
        return send(res, status, body);
      }
      if (req.method === 'GET' && path === '/depot/api/v1/ai/crm/access') {
        const [status, body] = crmAccess(req);
        return send(res, status, body);
      }
      if (req.method === 'GET' && path === '/depot/api/v1/ai/team/access') {
        const [status, body] = teamAccess(req);
        return send(res, status, body);
      }
      if (post && path === '/depot/api/v1/ai/drafts/depots/from-crm') {
        const [status, body] = crmDraft(req, parseJson(raw));
        return send(res, status, body);
      }
      if (req.method === 'GET' && path.startsWith('/depot/api/v1/ai/drafts/depots/from-crm/')) {
        const [status, body] = crmDraftStatus(req, path.slice('/depot/api/v1/ai/drafts/depots/from-crm/'.length));
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
        state.accessAsks.clear();
        state.crmDrafts.clear();
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
