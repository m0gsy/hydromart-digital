import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Registry, Histogram } from 'prom-client';

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

  const http = app.getHttpAdapter().getInstance();

  http.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') return next();
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
