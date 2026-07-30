import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

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
      { on: (_e: string, cb: () => void) => finish.push(cb), statusCode: 200 } as unknown as Response,
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
      { on: (_e: string, cb: () => void) => finish.push(cb), statusCode: 404 } as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );
    finish[0]();

    const end = jest.fn();
    await routes.get('/metrics')!({} as Request, { set: jest.fn(), end } as unknown as Response);
    expect(end.mock.calls[0][0] as string).toContain('route="/nope"');
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
