import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Counter, Registry, Histogram } from 'prom-client';

import { guardProcess } from './process-guard';

/*
 * W8 — a prom-client series is never evicted, so an unbounded `route` label is unbounded
 * process memory.
 *
 * The old label was `req.route?.path ?? req.path`, which is only safe where Express has
 * MATCHED a route. The gateway never does: it dispatches with `instance.use(...)`, so
 * `req.route` is undefined for every proxied request and the label was the raw URL.
 * Measured against production: 20 GET requests to random paths grew the registry from
 * 101,894 to 132,302 bytes — ~1.5 KB per URL, permanently. One crawler is enough, and the
 * gateway shares a box with Postgres.
 *
 * Two mechanisms, because either alone still loses:
 *  - templating collapses the COMMON case (a thousand order ids → one series), but a path
 *    with no id in it templates to itself, and the attacker picks the paths;
 *  - the ceiling is therefore what makes it BOUNDED. Past it, everything is `other`.
 *
 * 1024 is sized off the route table, not invented: `scripts/check-route-authz.mjs` counts
 * 697 (method, path) routes across all services, so distinct paths are fewer than that —
 * the ceiling clears every real route with room to grow, and a flood is what hits it. The
 * length cap matters for the same reason the count cap does: 1024 labels of 4 KB each is
 * still 4 MB nobody asked for.
 */
const ROUTE_LABEL_CEILING = 1024;
/*
 * The two Android packages that exist — `mobile/capacitor.config.ts` and the ops build.
 * Hardcoded rather than configured because they are store identities: they ship inside
 * every installed binary and cannot change without a new listing. Any other value is a
 * caller inventing one, and is dropped rather than counted as a phantom install.
 */
const CLIENT_APPS = new Set(['id.hydromart.app', 'id.hydromart.ops']);
const CLIENT_VERSION_CEILING = 64;
const ROUTE_LABEL_MAX_LENGTH = 128;
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;

// Every id in this platform is a uuid (`@default(uuid())`) or a bare number; anything else
// is left alone and answered for by the ceiling.
function templateOf(path: string): string {
  return path
    .replace(UUID_SEGMENT, '/:id')
    .replace(NUMERIC_SEGMENT, '/:id')
    .slice(0, ROUTE_LABEL_MAX_LENGTH);
}

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
 * Route label is bounded — see routeLabel() below for why that needs two mechanisms.
 */
export function enableMetrics(app: INestApplication, serviceName: string): void {
  /*
   * Rides along here, and the reason is not tidiness: all 18 services already call this
   * function, and a process guard that 17 of them have is not a guard. Wiring it into each
   * `main.ts` instead would be 18 edits that drift the first time somebody adds a service.
   */
  guardProcess(serviceName);

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
   * Cardinality is bounded the same way `route` is, and for the same reason: BOTH labels
   * arrive in request headers, so the caller picks them. An earlier version of this comment
   * said they were "bounded by construction — two packages, one label per build", and the
   * only thing construction actually bounded was their SHAPE: `/^[\w.-]{1,64}$/` admits
   * about 10^70 package ids and `/^\d{1,12}$/` admits 10^12 versions. Anyone with curl
   * could mint series here as fast as they could send requests, in the same process whose
   * memory the route ceiling above exists to protect.
   *
   * So: `app` is an allowlist of the two packages that exist, and `version` gets a ceiling.
   * 2 x 64 = 128 series, and past it a build reports as `other` rather than as itself.
   */
  const clientApp = new Counter({
    name: 'client_app_requests_total',
    help: 'Requests by installed app package and build (mobile only; browsers send neither header)',
    labelNames: ['app', 'version'],
    registers: [registry],
  });

  // Per-app, so the ceiling is per-process — the thing whose memory is at stake.
  const knownRoutes = new Set<string>();
  const knownVersions = new Set<string>();

  function routeLabel(req: Request): string {
    // A matched route is bounded by the router itself (a finite, registered set), so it is
    // spent against no ceiling — otherwise a junk flood would push REAL routes into `other`
    // and take the metric down with the memory it was protecting.
    const matched = req.route?.path as string | undefined;
    if (typeof matched === 'string') return matched;
    const template = templateOf(req.path);
    if (knownRoutes.has(template)) return template;
    // `other` cannot collide with a template: every path starts with '/'.
    if (knownRoutes.size >= ROUTE_LABEL_CEILING) return 'other';
    knownRoutes.add(template);
    return template;
  }

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
    if (
      typeof appId === 'string' &&
      typeof appVersion === 'string' &&
      CLIENT_APPS.has(appId) &&
      /^\d{1,12}$/.test(appVersion)
    ) {
      // The version ceiling: a real fleet carries a handful of builds at once, so anything
      // past 64 distinct ones is somebody generating them. They still get counted, under
      // one shared label, which keeps the total honest without minting a series per value.
      const bounded = knownVersions.has(appVersion)
        ? appVersion
        : knownVersions.size < CLIENT_VERSION_CEILING
          ? (knownVersions.add(appVersion), appVersion)
          : 'other';
      clientApp.inc({ app: appId, version: bounded });
    }
    const end = httpDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      // At finish, not before: req.route is only populated once Express has routed.
      end({ route: routeLabel(req), status: String(res.statusCode) });
    });
    next();
  });
}
