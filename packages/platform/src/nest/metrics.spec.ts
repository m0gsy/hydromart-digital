import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { encodeCursor } from '../domain/keyset';
import { enableMetrics } from './metrics';

type Handler = (req: Request, res: Response) => Promise<void> | void;
type Middleware = (req: Request, res: Response, next: NextFunction) => void;

function fakeApp() {
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

describe('enableMetrics: a cursor we cannot read (FLW-014)', () => {
  // pageArgs ignores a cursor it cannot decode and serves page 1 (a guard against P2025). That is
  // kept (owner decision), but it must not be silent: the response says the cursor was ignored,
  // so a feed that would otherwise repeat page 1 can notice and reset.
  const run = (query: Record<string, unknown>) => {
    const { app, middleware } = fakeApp();
    enableMetrics(app, 'order-service');
    const setHeader = jest.fn();
    middleware[0](
      { path: '/api/v1/orders', method: 'GET', query } as unknown as Request,
      { on: jest.fn(), setHeader, statusCode: 200 } as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );
    return setHeader;
  };

  it('flags a cursor that does not decode', () => {
    expect(run({ cursor: 'whatever-they-typed' })).toHaveBeenCalledWith('X-Cursor-Ignored', '1');
  });

  it('says nothing for a cursor we wrote, an empty one, or none', () => {
    expect(run({ cursor: encodeCursor('row-1') })).not.toHaveBeenCalled();
    expect(run({ cursor: '' })).not.toHaveBeenCalled();
    expect(run({})).not.toHaveBeenCalled();
    expect(run({ cursor: ['a', 'b'] })).not.toHaveBeenCalled();
  });
});

describe('enableMetrics', () => {
  it('exposes /metrics with the default process metrics and the service label', async () => {
    const { app, routes } = fakeApp();
    enableMetrics(app, 'order-service');

    const set = jest.fn();
    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set, end } as unknown as Response);

    expect(set).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/plain'));
    const payload = end.mock.calls[0][0] as string;
    expect(payload).toContain('service="order-service"');
    expect(payload).toContain('process_cpu_seconds_total');
  });

  it('times a request and labels it with the matched ROUTE, not the raw url', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'depot-service');

    const finish: (() => void)[] = [];
    const next = jest.fn();
    middleware[0](
      {
        path: '/api/v1/depots/abc-123',
        method: 'GET',
        route: { path: '/api/v1/depots/:id' },
      } as unknown as Request,
      {
        on: (_e: string, cb: () => void) => finish.push(cb),
        statusCode: 200,
      } as unknown as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalled();
    finish[0]();

    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
    const payload = end.mock.calls[0][0] as string;
    // The templated path is what keeps this from becoming one series per order id.
    expect(payload).toContain('route="/api/v1/depots/:id"');
    expect(payload).not.toContain('abc-123');
  });

  it('falls back to the raw path for a request that never matched a route (404)', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'auth-service');

    const finish: (() => void)[] = [];
    middleware[0](
      { path: '/nope', method: 'GET' } as unknown as Request,
      {
        on: (_e: string, cb: () => void) => finish.push(cb),
        statusCode: 404,
      } as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );
    finish[0]();

    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
    expect(end.mock.calls[0][0] as string).toContain('route="/nope"');
  });

  /*
   * N9. Nothing recorded which binaries are installed out there, so the compatibility floor
   * — the oldest build an API change must not break — was a guess. The client tags every
   * request with its package and build; this is the only place that turns them into a
   * number somebody can read.
   */
  it('counts requests by the installed package and build', async () => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    middleware[0](
      {
        path: '/api/v1/orders',
        method: 'GET',
        headers: { 'x-app-id': 'id.hydromart.app', 'x-app-version': '1204' },
      } as unknown as Request,
      { on: jest.fn(), statusCode: 200 } as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );

    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
    const payload = end.mock.calls[0][0] as string;
    // The registry stamps `service` on every series, so this asserts the labels it adds,
    // not the whole line.
    expect(payload).toContain('client_app_requests_total{app="id.hydromart.app",version="1204"');
    expect(payload).toMatch(/client_app_requests_total\{[^}]*\} 1/);
  });

  /*
   * A label pair is a series that lives forever. Browser traffic sends neither header, and
   * a spoofed one must not be able to mint series — hence the shape check rather than trust.
   */
  it.each([
    ['a browser sending neither header', {}],
    ['a version with no package', { 'x-app-version': '1204' }],
    ['a package with no version', { 'x-app-id': 'id.hydromart.app' }],
    [
      'a version that is not a number',
      { 'x-app-id': 'id.hydromart.app', 'x-app-version': 'latest' },
    ],
    ['a package id with room for anything', { 'x-app-id': 'a b"c', 'x-app-version': '1' }],
  ])('records nothing for %s', async (_case, headers) => {
    const { app, routes, middleware } = fakeApp();
    enableMetrics(app, 'gateway-service');

    middleware[0](
      { path: '/api/v1/orders', method: 'GET', headers } as unknown as Request,
      { on: jest.fn(), statusCode: 200 } as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );

    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
    expect(end.mock.calls[0][0] as string).not.toContain('client_app_requests_total{');
  });

  // Scraping must not appear in its own histogram, or the series grows every 15s
  // with a data point nobody wants.
  it('skips the scrape endpoint itself', () => {
    const { app, middleware } = fakeApp();
    enableMetrics(app, 'x');
    const on = jest.fn();
    const next = jest.fn();
    middleware[0](
      { path: '/metrics', method: 'GET' } as unknown as Request,
      { on } as unknown as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });
});
