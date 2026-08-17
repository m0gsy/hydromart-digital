import { createHash } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { Express, Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { GatewayConfigService } from './config/gateway-config.service';
import { resolveRoute } from './routing/route-table';
import { AT_COOKIE, createSessionRouter, readCookie } from './routing/session-bff';

// Kept in sync with @hydromart/platform's INTERNAL_KEY_HEADER. Inlined so the
// gateway (a pure proxy) doesn't import the platform barrel, which transitively
// pulls the JWT guard + @nestjs/jwt the gateway has no reason to depend on.
const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * J5: the limiter's default key is `req.ip`, which makes a bucket belong to a NETWORK,
 * not to a person. Eight couriers behind one depot router or one 4G hotspot share a
 * single NAT address and therefore a single counter — and `offline-queue.ts` makes them
 * all flush at the same instant when signal returns, so the burst is not hypothetical.
 * Keying on the caller's own credential gives each of them their own budget. Web gains
 * the same fix for free: two staff on one office line stop sharing a counter.
 *
 * Deliberately reads BOTH transports, because this middleware runs ahead of the
 * cookie -> Authorization translation further down: the browser sends the httpOnly
 * access cookie, the native shell will send the header. Anonymous traffic (login,
 * catalogue browsing) has neither and keeps the IP bucket, which is the right answer
 * there — an unauthenticated flood has no identity to charge.
 *
 * Hashed rather than stored raw so the limiter's key set never holds a usable token.
 *
 * ponytail: the access token rotates on refresh, so a bucket resets every ~15 min.
 * Harmless (refresh is itself limited, and reuse detection revokes a family that spams
 * it); key on the JWT `sub` claim instead if that ever proves too generous.
 */
export function rateLimitKey(req: Request): string {
  const credential = req.headers.authorization ?? readCookie(req, AT_COOKIE);
  if (credential) {
    return `t:${createHash('sha256').update(credential).digest('base64url').slice(0, 22)}`;
  }
  return `i:${req.ip ?? 'unknown'}`;
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

  // B-2: express-rate-limit keys on `req.ip`. Behind Caddy every request arrives from
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

  app.use(helmet());
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
   * Every call that issues a code sends a real SMS through Zenziva, and Zenziva invoices
   * per message. auth-service caps RESENDS per customer — but nothing capped a caller who
   * walks a different phone number on each request, which is the shape that costs money:
   * one IP, one script, six hundred numbers a minute under the general ceiling, every one
   * of them a paid message to a stranger's handset.
   *
   * Keyed by IP because these callers have no credential yet, and deliberately strict: a
   * human registering needs three calls (register, maybe one resend, verify), so twenty a
   * minute is roughly seven honest attempts and nothing like a pump.
   *
   * Independent of the general limit and of the HQ request storm that inflated it — this
   * tier can be tightened on its own merits without waiting for that measurement.
   */
  const OTP_ISSUING = /^\/auth\/api\/v\d+\/auth\/(register|login|otp\/resend)$/;
  app.use(
    rateLimit({
      windowMs: config.rateLimit.ttlSeconds * 1000,
      limit: config.rateLimit.otpLimit,
      standardHeaders: true,
      legacyHeaders: false,
      // `req.ip` is always set behind the trust-proxy setting above; the prefix is what
      // keeps this bucket separate from the general one for the same address.
      keyGenerator: (req) => `otp:${req.ip}`,
      skip: (req) => !OTP_ISSUING.test(req.path),
      message: { statusCode: 429, message: 'Too many verification requests' },
    }),
  );

  app.use(
    rateLimit({
      windowMs: config.rateLimit.ttlSeconds * 1000,
      limit: config.rateLimit.limit,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: rateLimitKey,
      // `/mobile-config` joins `/health` as exempt for the same reason: it is read once
      // per app launch, before the user has done anything, by every installed device. A
      // 429 there would fail the one check whose whole job is to be answerable.
      skip: (req) => req.path === '/health' || req.path === '/mobile-config',
      message: { statusCode: 429, message: 'Too many requests' },
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
  instance.get('/mobile-config', (_req, res) => {
    res.json(config.mobile);
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
