import { createHmac, timingSafeEqual } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { Express, Request, RequestHandler } from 'express';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { GatewayConfigService } from './config/gateway-config.service';
import { resolveRoute } from './routing/route-table';
import { AT_COOKIE, createSessionRouter, readCookie } from './routing/session-bff';
import { tokenBucket } from './rate-limit/token-bucket';

// Kept in sync with @hydromart/platform's INTERNAL_KEY_HEADER. Inlined so the
// gateway (a pure proxy) doesn't import the platform barrel, which transitively
// pulls the JWT guard + @nestjs/jwt the gateway has no reason to depend on.
const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * J5: the limiter's default key is `req.ip`, which makes a bucket belong to a NETWORK,
 * not to a person. Eight couriers behind one depot router or one 4G hotspot share a
 * single NAT address and therefore a single counter — and `offline-queue.ts` makes them
 * all flush at the same instant when signal returns, so the burst is not hypothetical.
 * Keying on the caller's own identity gives each of them their own budget. Web gains the
 * same fix for free: two staff on one office line stop sharing a counter.
 *
 * L3-SEC-1 — and this is the part that was wrong. The key came from the raw credential:
 *
 *     if (credential) return `t:${sha256(credential)}`;
 *
 * "Anonymous traffic has neither and keeps the IP bucket" was true only of a caller that
 * sends no header. `Authorization: Bearer <anything>` is also anonymous, and it chose its
 * own bucket. Measured against the running gateway, one address, one read endpoint:
 *
 *     no header, IP bucket already spent   ->   0 of 60 passed
 *     junk bearer, rotated per request     ->  28 of 60 passed
 *
 * So an address that was fully rate-limited got its service back by attaching a token
 * nobody issued. A ceiling anyone can opt out of is not a ceiling. The e2e suite passed
 * throughout, because it asserted this behaviour on purpose with the literal identities
 * `courier-a` and `courier-b` — the defect was written down as the specification.
 *
 * Now the identity has to be one we can PROVE we issued: HS256 verified against
 * `JWT_ACCESS_SECRET`, then keyed on the `sub` claim. Three consequences worth naming:
 *
 *  - An unverifiable credential is treated exactly like no credential — the IP bucket.
 *    That is the pre-J5 answer, and it is the safe direction to be wrong in.
 *  - `sub` rather than the token bytes also fixes the note the old comment left behind:
 *    the access token rotates on refresh, so keying on it handed out a fresh budget every
 *    ~15 minutes. One person is now one bucket across refreshes.
 *  - No secret configured means no credential is verifiable, so every caller falls back to
 *    their address. The gateway still boots and still limits, just coarsely; it never
 *    degrades to bypassable.
 *
 * Deliberately reads BOTH transports, because this middleware runs ahead of the
 * cookie -> Authorization translation further down: the browser sends the httpOnly
 * access cookie, the native shell sends the header.
 *
 * The `sub` is a user id, not a credential, so it is used as-is; the old hash existed to
 * keep a usable token out of the limiter's key set and there is no longer a token in it.
 */
export function rateLimitKey(req: Request, secret = ''): string {
  const credential = req.headers.authorization ?? readCookie(req, AT_COOKIE);
  if (credential && secret) {
    const sub = verifiedSubject(credential, secret);
    if (sub) return `u:${sub}`;
  }
  return `i:${req.ip ?? 'unknown'}`;
}

/**
 * The `sub` of a token this deployment can prove it signed, or null for anything else.
 *
 * Not a full authorisation check and not a substitute for one — each service still
 * verifies for itself. This answers one question: may this caller be trusted to NAME its
 * own rate-limit bucket? Only a signature we can recompute can answer yes.
 *
 * `alg` is required to be HS256 rather than read from the token. Trusting the token's own
 * `alg` is the classic JWT forgery: `none` makes every signature valid, and naming an
 * asymmetric algorithm invites the verifier to check a public key as if it were a secret.
 */
function verifiedSubject(credential: string, secret: string): string | null {
  const token = credential.startsWith('Bearer ') ? credential.slice(7).trim() : credential.trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;

  let header: { alg?: unknown };
  let payload: { sub?: unknown; exp?: unknown };
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (header?.alg !== 'HS256') return null;

  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  // timingSafeEqual THROWS on a length mismatch, and a wrong-length signature is the
  // commonest malformed input there is — so the length is checked first, not caught after.
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  // An expired token is authentic, so it cannot be forged — but honouring it forever would
  // let one harvested token keep minting a private bucket long after it stopped being a
  // login. `exp` is seconds since the epoch (RFC 7519 §4.1.4).
  if (typeof payload?.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;

  return typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
}

/**
 * Wires the gateway's request pipeline onto the underlying Express instance:
 * helmet + CORS, an owned `GET /health`, one proxy per known service segment,
 * and a catch-all 404 for unknown segments. Shared by main.ts and the e2e test.
 *
 * Call BEFORE app.init()/listen() so these handlers sit ahead of Nest's own
 * router + fallback 404 (which init() registers) in the middleware stack.
 */
/**
 * `trust proxy = 1` and a publicly bound gateway port are safe apart and a rate-limit
 * bypass together.
 *
 * The gateway's port is published to loopback only (`${PUBLIC_BIND:-127.0.0.1}:8080`), so
 * Caddy is the sole path in and the one X-Forwarded-For hop it appends is trustworthy.
 * Set `PUBLIC_BIND=0.0.0.0` — which .env.production.example offers as an ordinary option
 * for a bare-IP box — and anyone can reach 8080 directly and prepend their own
 * X-Forwarded-For. Express believes the LAST hop it does not own, so every request can
 * carry a fresh fake client IP and the per-IP limiter counts each one separately: the
 * limit stops existing, and nothing looks wrong.
 *
 * Two comments have documented this since the line was written. A comment does not refuse
 * to boot. Production does, and says which of the two to change.
 */
export function trustProxyHops(
  nodeEnv: string,
  publicBind: string | undefined,
  webDomain: string | undefined,
): number {
  const bind = (publicBind ?? '').trim();
  const domain = (webDomain ?? '').trim();
  // Empty = compose's own default, which is loopback. `::1` is the IPv6 spelling of it.
  const loopbackOnly =
    bind === '' || bind === '127.0.0.1' || bind === 'localhost' || bind === '::1';

  // No Caddy in front (the documented bare-IP deploy). Trusting a hop that does not exist
  // lets EVERY client name its own IP, so the per-IP limiter counts a different fake
  // address each request. This has been the standing state of any bare-IP box: the bind
  // was the deliberate choice, the trust was the leftover.
  if (domain === '') return 0;

  // Caddy IS in front and the port is public too, so both paths are open at once: one
  // through the proxy, one straight past it carrying whatever X-Forwarded-For it likes.
  // Two comments have documented this since the line was written; a comment does not
  // refuse to boot.
  if (!loopbackOnly && nodeEnv === 'production') {
    throw new Error(
      `PUBLIC_BIND=${bind} publishes the gateway port beyond loopback while WEB_DOMAIN=${domain} ` +
        'puts Caddy in front, so the trusted X-Forwarded-For hop can be forged by anyone who ' +
        'skips the proxy and the per-IP rate limit stops existing. Either set ' +
        'PUBLIC_BIND=127.0.0.1 so Caddy is the only way in, or drop WEB_DOMAIN and run ' +
        'genuinely bare — refusing to start rather than serving an unlimited edge.',
    );
  }
  return 1;
}

export function configureGateway(app: INestApplication, config: GatewayConfigService): void {
  const expressApp = app.getHttpAdapter().getInstance() as Express;

  // B-2: the limiter keys on `req.ip`. Behind Caddy every request arrives from
  // Caddy's address, so without this the socket peer IS the proxy and all traffic from
  // all users shares ONE counter — the configured limit stops being per-user and becomes
  // per-deployment. One staff member opening one HQ page could 429 the whole platform.
  //
  // `1` = trust exactly one hop (Caddy) and no further, so a client cannot prepend its own
  // X-Forwarded-For entry and be believed. This is only safe because the gateway's port is
  // bound to loopback in docker-compose.prod.yml (H-19) — Caddy is the sole path in. If
  // that port is ever published again, this line becomes a rate-limit bypass.
  expressApp.set(
    'trust proxy',
    trustProxyHops(config.nodeEnv, process.env.PUBLIC_BIND, process.env.WEB_DOMAIN),
  );

  // H-23 continued. Caddy terminates TLS and is the only place that sees it, so the edge
  // owns Content-Security-Policy and Strict-Transport-Security for this host (Caddyfile
  // says so in as many words). helmet's defaults sent a SECOND copy of both, and the live
  // API host was answering with two of each: two CSP headers — browsers enforce the
  // intersection, so that one worked by accident — and two HSTS headers whose max-age
  // disagreed, 31536000 from Caddy against 15552000 here. Which of those a browser obeys
  // is decided by header order, not by anything anyone chose.
  //
  // The consequence is the one the Caddyfile already accepts for the web app: a bare-IP
  // deploy with no `--profile tls` gets neither. HSTS asserts nothing without HTTPS to
  // assert it over, and this host serves JSON — `/docs` is fail-closed in production — so
  // there is no document for a policy to protect. Everything else helmet does (noSniff,
  // referrer-policy, frameguard, and the rest) is untouched.
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  // SEC-3: edge rate-limit at the single public ingress (per-IP), using the RATE_LIMIT_*
  // config that was already carried here for this purpose. /health is exempt so probes
  // never trip it. ponytail: default in-memory store — correct for the current single
  // gateway instance; swap in a shared store (rate-limit-redis, and the Redis container
  // Q-9 removed) once the gateway scales horizontally, so counters are shared across
  // instances instead of each replica granting the full quota on its own.
  /*
   * The OTP tier, and it is a BILLING control before it is an availability one.
   *
   * Every call that issues a code sends a real SMS through Zenziva, and Zenziva invoices per
   * message. auth-service caps RESENDS per customer — but nothing capped a caller who walks
   * a different phone number on each request, which is the shape that costs money: one IP,
   * one script, and every request past the ceiling is a paid message to a stranger's handset.
   *
   * Keyed by address because these callers hold no credential yet, and deliberately strict:
   * a human registering needs three calls, so twenty is roughly seven honest attempts.
   */
  const OTP_ISSUING = /^\/auth\/api\/v\d+\/auth\/(register|login|otp\/resend)$/;
  app.use(
    tokenBucket({
      capacity: config.rateLimit.otpLimit,
      refillPerSecond: config.rateLimit.otpLimit / config.rateLimit.ttlSeconds,
      keyGenerator: (req) => `otp:${req.ip}`,
      skip: (req) => !OTP_ISSUING.test(req.path),
      message: 'Too many verification requests',
    }),
  );

  /*
   * The general limiter. One bucket, not two windows.
   *
   * `RATE_LIMIT_MAX` per `RATE_LIMIT_TTL_SECONDS` is the SUSTAINED rate, so it becomes the
   * refill; `RATE_LIMIT_BURST_MAX` is how much may be spent at once, so it becomes the
   * capacity. Those are exactly the two things the fixed window and the burst window were
   * each trying to express alone — and the bucket has no wall-clock boundary to double up
   * across, which is the leak that made the second window necessary in the first place.
   *
   * `/health` and `/mobile-config` stay exempt: the first is how anything knows the gateway
   * is alive, and the second is read once per app launch by every installed device before
   * the user has done anything. A 429 on either fails the one check whose job is to answer.
   */
  app.use(
    tokenBucket({
      capacity: config.rateLimit.burstLimit,
      refillPerSecond: config.rateLimit.limit / config.rateLimit.ttlSeconds,
      keyGenerator: (req) => rateLimitKey(req, config.accessTokenSecret),
      skip: (req) => req.path === '/health' || req.path === '/mobile-config',
    }),
  );

  const upstreams = config.upstreams();
  const proxies = new Map<string, RequestHandler>();
  for (const [segment, target] of Object.entries(upstreams)) {
    proxies.set(
      segment,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite: { [`^/${segment}`]: '' },
      }) as unknown as RequestHandler,
    );
  }

  const instance = expressApp;

  instance.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gateway-service', timestamp: new Date().toISOString() });
  });

  /**
   * F5. The minimum version the installed app is allowed to be. Read once per launch, by
   * the shell, before anything else happens.
   *
   * This has to exist BEFORE the first Play upload. A version gate cannot be added later
   * to a binary already on someone's phone — the only code that could enforce it is the
   * code that is not in that build. The endpoint may return `0` forever and never block
   * anybody; what matters is that every shipped binary knows to ask.
   *
   * Owned by the gateway rather than proxied, like `/health`: there is no service behind
   * it, and for the same reason it is NOT in `apps/web/src/lib/endpoints/` —
   * `check-endpoint-contracts.mjs` fails any path with no owning service, and adding an
   * allowlist file to hold one string is more machinery than the literal it replaces.
   */
  instance.get('/mobile-config', (req, res) => {
    // N5: `?id=` names WHICH binary is asking. Absent (older builds in the field) answers
    // the global floor, exactly as before — the gate ships in a binary that cannot be
    // changed later, so the endpoint has to keep answering the version of the question
    // those builds know how to ask.
    const id = typeof req.query.id === 'string' ? req.query.id : undefined;
    res.json(config.mobileFor(id));
  });

  // SEC-4: BFF session lifecycle (login-verify/refresh/logout) — owns httpOnly cookies.
  // Mounted ahead of the proxy; non-session /auth/* paths fall through untouched.
  instance.use('/auth', createSessionRouter(upstreams.auth, config.isProduction));

  instance.use((req, res, next) => {
    // Defense-in-depth: the internal service key authenticates trusted service-to-service
    // calls as a SUPER_ADMIN system principal (platform JwtAuthGuard). Those calls go
    // direct via *_SERVICE_URL and never transit the gateway, so strip any client-supplied
    // header here — a browser must never be able to inject it and escalate.
    delete req.headers[INTERNAL_KEY_HEADER];
    // SEC-4: translate the httpOnly access cookie into the bearer header services expect,
    // so the browser holds no readable token. An explicit Authorization header (none from
    // the SPA now) is left intact.
    if (!req.headers.authorization) {
      const at = readCookie(req, AT_COOKIE);
      if (at) req.headers.authorization = `Bearer ${at}`;
    }
    const route = resolveRoute(req.path, upstreams);
    const proxy = route ? proxies.get(route.segment) : undefined;
    if (!proxy) {
      res.status(404).json({ statusCode: 404, message: 'Unknown service route' });
      return;
    }
    proxy(req, res, next);
  });
}
