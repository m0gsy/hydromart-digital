import type { INestApplication } from '@nestjs/common';

import { protectDocs } from './docs-guard';

type Middleware = (req: unknown, res: unknown, next: () => void) => void;

function fakeApp(): { app: INestApplication; middlewares: Middleware[] } {
  const middlewares: Middleware[] = [];
  const app = { use: (mw: Middleware) => middlewares.push(mw) } as unknown as INestApplication;
  return { app, middlewares };
}

interface FakeRes {
  set: jest.Mock;
  status: jest.Mock;
  send: jest.Mock;
  sent: string[];
}

function fakeRes(): FakeRes {
  const sent: string[] = [];
  const res: FakeRes = {
    set: jest.fn(() => res),
    status: jest.fn(() => res),
    send: jest.fn((body: string) => sent.push(body)),
    sent,
  };
  return res;
}

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('protectDocs', () => {
  it('leaves docs open outside production', () => {
    process.env.NODE_ENV = 'development';
    const { app, middlewares } = fakeApp();
    expect(protectDocs(app)).toBe(true);
    expect(middlewares).toHaveLength(0);
  });

  it('refuses to mount docs in production when no credentials are set (fail closed)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DOCS_USER;
    delete process.env.DOCS_PASSWORD;
    const { app, middlewares } = fakeApp();
    expect(protectDocs(app)).toBe(false);
    expect(middlewares).toHaveLength(0);
  });

  it('refuses to mount when only one half of the credentials is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCS_USER = 'admin';
    delete process.env.DOCS_PASSWORD;
    expect(protectDocs(fakeApp().app)).toBe(false);
  });

  it('challenges an unauthenticated docs request in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCS_USER = 'admin';
    process.env.DOCS_PASSWORD = 's3cret';
    const { app, middlewares } = fakeApp();
    expect(protectDocs(app)).toBe(true);

    const res = fakeRes();
    const next = jest.fn();
    middlewares[0]({ path: '/docs', headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Hydromart docs"');
  });

  it('lets the right credentials through, on the path and its subpaths', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCS_USER = 'admin';
    process.env.DOCS_PASSWORD = 's3cret';
    const { app, middlewares } = fakeApp();
    protectDocs(app);
    const authorization = `Basic ${Buffer.from('admin:s3cret').toString('base64')}`;

    for (const path of ['/docs', '/docs/', '/docs/swagger-ui.css']) {
      const next = jest.fn();
      middlewares[0]({ path, headers: { authorization } }, fakeRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('rejects wrong credentials and a wrong-length header without throwing', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCS_USER = 'admin';
    process.env.DOCS_PASSWORD = 's3cret';
    const { app, middlewares } = fakeApp();
    protectDocs(app);

    for (const authorization of [
      `Basic ${Buffer.from('admin:wrong').toString('base64')}`,
      'Basic short',
      'Bearer token',
    ]) {
      const next = jest.fn();
      middlewares[0]({ path: '/docs', headers: { authorization } }, fakeRes(), next);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('ignores requests that are not under the docs path', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCS_USER = 'admin';
    process.env.DOCS_PASSWORD = 's3cret';
    const { app, middlewares } = fakeApp();
    protectDocs(app);

    // `/docsomething` must NOT be treated as a docs subpath.
    for (const path of ['/api/v1/health', '/docsomething']) {
      const next = jest.fn();
      middlewares[0]({ path, headers: {} }, fakeRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });
});
