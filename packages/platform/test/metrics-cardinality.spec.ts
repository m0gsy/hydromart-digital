import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { enableMetrics } from '../src/nest/metrics';

/*
 * W8 — the `route` label was unbounded, in the process that shares a box with Postgres.
 *
 * The gateway is a pure proxy: it dispatches with `instance.use(...)`, never a route, so
 * `req.route` is undefined for EVERY proxied request and the label fell back to the raw
 * `req.path`. Measured against production: 20 GET requests to random paths grew the
 * registry from 101,894 to 132,302 bytes — ~1.5 KB per URL, and permanent, because a
 * prom-client series is never evicted. One crawler is enough.
 *
 * These are the two halves of the fix, and they are separate claims:
 *  - normalisation makes the COMMON case collapse (a thousand order ids = one series);
 *  - the ceiling is what makes it BOUNDED, because a path with no id in it normalises to
 *    itself and an attacker picks the paths.
 * A test for either one alone would pass over the other's absence.
 */

type Handler = (req: Request, res: Response) => Promise<void> | void;
type Middleware = (req: Request, res: Response, next: NextFunction) => void;

// Duplicated from src/nest/metrics.spec.ts rather than shared: a two-line fake is cheaper
// than a helper module both suites have to agree on.
function fakeApp(): { app: INestApplication; routes: Map<string, Handler>; middleware: Middleware[] } {
  const routes = new Map<string, Handler>();
  const middleware: Middleware[] = [];
  const app = {
    getHttpAdapter: () => ({
      getInstance: () => ({ get: (p: string, h: Handler) => routes.set(p, h) }),
    }),
    use: (m: Middleware) => middleware.push(m),
  } as unknown as INestApplication;
  return { app, routes, middleware };
}

/** One request through the metrics middleware, all the way to `res.on('finish')`. */
function request(mw: Middleware, path: string, matched?: string): void {
  const finish: (() => void)[] = [];
  mw(
    { path, method: 'GET', headers: {}, route: matched ? { path: matched } : undefined } as unknown as Request,
    { on: (_e: string, cb: () => void) => finish.push(cb), statusCode: 200 } as unknown as Response,
    (() => undefined) as unknown as NextFunction,
  );
  finish[0]();
}

async function scrape(routes: Map<string, Handler>): Promise<string> {
  const end = jest.fn();
  await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
  return end.mock.calls[0][0] as string;
}

/** Every distinct `route` label value in the payload — i.e. the cardinality this bounds. */
function routeLabels(payload: string): Set<string> {
  const seen = new Set<string>();
  for (const m of payload.matchAll(/route="([^"]*)"/g)) seen.add(m[1]);
  return seen;
}

// The ceiling in metrics.ts. Asserted as a literal, not imported: importing it would make
// every expectation below true by definition.
const CEILING = 1024;

describe('enableMetrics route-label cardinality', () => {
  it('collapses a thousand distinct ids into one series', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    for (let i = 0; i < 1000; i++) {
      // A uuid per request, exactly as a real /orders/:id fetch arrives at the gateway.
      const id = `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`;
      request(middleware[0], `/api/v1/orders/${id}`);
    }

    const labels = routeLabels(await scrape(routes));
    expect([...labels]).toEqual(['/api/v1/orders/:id']);
  });

  it('collapses numeric segments too', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'order-service');

    for (let i = 0; i < 500; i++) request(middleware[0], `/api/v1/invoices/${i}/lines/${i * 7}`);

    expect([...routeLabels(await scrape(routes))]).toEqual(['/api/v1/invoices/:id/lines/:id']);
  });

  /*
   * The half that actually bounds memory. These paths carry no id to normalise away, so
   * normalisation alone leaves one series per path — which is the production finding.
   */
  it('stops minting series once the ceiling is reached', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    for (let i = 0; i < CEILING * 3; i++) request(middleware[0], `/${i.toString(36)}zz/wp-admin`);

    const labels = routeLabels(await scrape(routes));
    // ceiling distinct templates + the "other" bucket everything past it falls into.
    expect(labels.size).toBeLessThanOrEqual(CEILING + 1);
    expect(labels.has('other')).toBe(true);
  });

  /*
   * A route Express actually matched is bounded by the router itself — a finite set — so it
   * must not be spent against the ceiling, or a flood of junk would push real routes into
   * "other" and take the metric down with it. That is the attack turned inside out.
   */
  it('keeps labelling matched routes after the ceiling is exhausted', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    for (let i = 0; i < CEILING * 2; i++) request(middleware[0], `/${i.toString(36)}zz/wp-admin`);
    request(middleware[0], '/api/v1/depots/abc-123', '/api/v1/depots/:id');

    expect(routeLabels(await scrape(routes)).has('/api/v1/depots/:id')).toBe(true);
  });

  // A bounded COUNT of unbounded-length strings is still unbounded memory: a 4 KB URL
  // becomes a 4 KB label that is never evicted.
  it('truncates an absurdly long path', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    request(middleware[0], `/${'a'.repeat(4000)}`);

    for (const label of routeLabels(await scrape(routes))) expect(label.length).toBeLessThanOrEqual(128);
  });
});

/*
 * The second unbounded label, found only because somebody attacked the first fix's claim.
 *
 * `client_app_requests_total` carries `app` and `version`, and BOTH arrive in request
 * headers. The code that shipped validated their shape — `/^[\w.-]{1,64}$/` for the package
 * and `/^\d{1,12}$/` for the build — and a comment above it called that "bounded by
 * construction". Shape is not count: those patterns admit about 10^70 packages and 10^12
 * builds, every one of them a permanent series in the same process the route ceiling was
 * added to protect. curl in a loop was enough.
 */
function requestAs(mw: Middleware, appId: string, version: string): void {
  const finish: (() => void)[] = [];
  mw(
    {
      path: '/ping',
      method: 'GET',
      headers: { 'x-app-id': appId, 'x-app-version': version },
      route: undefined,
    } as unknown as Request,
    { on: (_e: string, cb: () => void) => finish.push(cb), statusCode: 200 } as unknown as Response,
    (() => undefined) as unknown as NextFunction,
  );
  finish[0]!();
}

function clientAppLines(payload: string): string[] {
  return payload.split(/\r?\n/).filter((l) => l.startsWith('client_app_requests_total{'));
}

// The ceiling in metrics.ts, again asserted as a literal rather than imported.
const VERSION_CEILING = 64;

describe('client app labels are bounded, not merely well-formed', () => {
  it('counts the two real packages and ignores an invented one', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');
    requestAs(middleware[0]!, 'id.hydromart.app', '104');
    requestAs(middleware[0]!, 'id.hydromart.ops', '104');
    requestAs(middleware[0]!, 'com.attacker.whatever', '104');

    const dump = await scrape(routes);
    expect(dump).toContain('id.hydromart.app');
    expect(dump).toContain('id.hydromart.ops');
    expect(dump).not.toContain('com.attacker');
  });

  it('a flood of well-formed version numbers cannot mint a series each', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');
    for (let i = 0; i < 500; i += 1) requestAs(middleware[0]!, 'id.hydromart.app', String(100000 + i));

    const lines = clientAppLines(await scrape(routes));
    // 64 real builds + the shared `other` bucket. Without the ceiling this is 500.
    expect(lines.length).toBeLessThanOrEqual(VERSION_CEILING + 1);
    expect(lines.join(' ')).toContain('version="other"');
  });

  it('and the flood is still COUNTED, just not itemised', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');
    for (let i = 0; i < 200; i += 1) requestAs(middleware[0]!, 'id.hydromart.app', String(200000 + i));

    const total = clientAppLines(await scrape(routes)).reduce(
      (sum, l) => sum + Number(l.trim().split(' ').pop()),
      0,
    );
    expect(total).toBe(200);
  });
});
