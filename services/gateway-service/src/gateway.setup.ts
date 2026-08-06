import { INestApplication } from '@nestjs/common';
import type { Express, RequestHandler } from 'express';
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
 * Wires the gateway's request pipeline onto the underlying Express instance:
 * helmet + CORS, an owned `GET /health`, one proxy per known service segment,
 * and a catch-all 404 for unknown segments. Shared by main.ts and the e2e test.
 *
 * Call BEFORE app.init()/listen() so these handlers sit ahead of Nest's own
 * router + fallback 404 (which init() registers) in the middleware stack.
 */
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
  expressApp.set('trust proxy', 1);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  // SEC-3: edge rate-limit at the single public ingress (per-IP), using the RATE_LIMIT_*
  // config that was already carried here for this purpose. /health is exempt so probes
  // never trip it. ponytail: default in-memory store — correct for the current single
  // gateway instance; swap in a shared store (rate-limit-redis, and the Redis container
  // Q-9 removed) once the gateway scales horizontally, so counters are shared across
  // instances instead of each replica granting the full quota on its own.
  app.use(
    rateLimit({
      windowMs: config.rateLimit.ttlSeconds * 1000,
      limit: config.rateLimit.limit,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
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
