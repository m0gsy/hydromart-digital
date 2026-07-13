import { INestApplication } from '@nestjs/common';
import type { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { GatewayConfigService } from './config/gateway-config.service';
import { resolveRoute } from './routing/route-table';

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
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });

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

  const instance = app.getHttpAdapter().getInstance() as Express;

  instance.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gateway-service', timestamp: new Date().toISOString() });
  });

  instance.use((req, res, next) => {
    // Defense-in-depth: the internal service key authenticates trusted service-to-service
    // calls as a SUPER_ADMIN system principal (platform JwtAuthGuard). Those calls go
    // direct via *_SERVICE_URL and never transit the gateway, so strip any client-supplied
    // header here — a browser must never be able to inject it and escalate.
    delete req.headers[INTERNAL_KEY_HEADER];
    const route = resolveRoute(req.path, upstreams);
    const proxy = route ? proxies.get(route.segment) : undefined;
    if (!proxy) {
      res.status(404).json({ statusCode: 404, message: 'Unknown service route' });
      return;
    }
    proxy(req, res, next);
  });
}
