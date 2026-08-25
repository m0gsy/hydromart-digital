import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Counter, Registry, Histogram } from 'prom-client';

/**
 * One-call Prometheus wiring for a Nest/Express service. Adds:
 *  - default Node/process metrics (event-loop lag, heap, GC, CPU, fds)
 *  - an http_request_duration_seconds histogram labelled by method/route/status
 *  - a GET /metrics scrape endpoint (kept OUTSIDE the `api` global prefix so
 *    Prometheus hits a stable path and auth guards never touch it)
 *
 * Call it in bootstrap() right after `NestFactory.create`, BEFORE listen:
 *   enableMetrics(app, 'order-service');
 *
 * ponytail: default registry per process is fine — one service = one process.
 * Route label uses the matched route path (not the raw URL) so high-cardinality
 * ids (/orders/:id) collapse to one series.
 */
export function enableMetrics(app: INestApplication, serviceName: string): void {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
  });

  /*
   * N9: which binaries are actually out there.
   *
   * The APK carries a FROZEN export — `cap sync` copies it in — so a phone keeps the UI it
   * was installed with until somebody updates. The real risk is API skew against binaries
   * in the field, and nothing recorded which ones those are: the compatibility floor was a
   * guess, and retiring an endpoint was a guess on top of it. The client sends its package
   * and build; this counts them.
   *
   * Cardinality is bounded by construction: two packages, one label per build that is still
   * installed somewhere, and the labels are dropped entirely for browser traffic (which
   * sends neither header).
   */
  const clientApp = new Counter({
    name: 'client_app_requests_total',
    help: 'Requests by installed app package and build (mobile only; browsers send neither header)',
    labelNames: ['app', 'version'],
    registers: [registry],
  });

  const http = app.getHttpAdapter().getInstance();

  http.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') return next();
    const appId = req.headers?.['x-app-id'];
    const appVersion = req.headers?.['x-app-version'];
    // Both, or neither: a version with no package cannot be attributed, and a package with
    // no version is the thing this counter exists to answer.
    if (typeof appId === 'string' && typeof appVersion === 'string' && /^[\w.-]{1,64}$/.test(appId) && /^\d{1,12}$/.test(appVersion)) {
      clientApp.inc({ app: appId, version: appVersion });
    }
    const end = httpDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      // req.route?.path is the templated path once Express has matched; fall back
      // to the raw path for 404s that never matched a route.
      const route = (req.route?.path as string) ?? req.path;
      end({ route, status: String(res.statusCode) });
    });
    next();
  });
}
