const init = jest.fn();
const captureException = jest.fn();
const withScope = jest.fn((fn: (scope: unknown) => void) =>
  fn({ setTag: jest.fn(), setTransactionName: jest.fn() }),
);

jest.mock('@sentry/node', () => ({ init, captureException, withScope }));

import { captureServerError, initSentry } from './sentry';

/** The `beforeSend` the module handed to Sentry.init, called with a synthetic event. */
const beforeSend = (event: Record<string, unknown>) =>
  (init.mock.calls[0][0] as { beforeSend: (e: unknown) => unknown }).beforeSend(event);

describe('sentry', () => {
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...env };
    delete process.env.SENTRY_DSN;
  });

  afterAll(() => {
    process.env = env;
  });

  it('does nothing at all without a DSN — no init, no send', async () => {
    const mod = await import('./sentry');
    mod.initSentry();
    mod.captureServerError(new Error('boom'), { method: 'GET', path: '/x', status: 500 });
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('initialises once, however many errors arrive', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example/1';
    const mod = await import('./sentry');
    mod.captureServerError(new Error('one'), { method: 'GET', path: '/a', status: 500 });
    mod.captureServerError(new Error('two'), { method: 'GET', path: '/b', status: 503 });
    expect(init).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('reports the image tag as the release — a deploy is what changes it', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example/1';
    process.env.IMAGE_TAG = 'sha-abc123';
    (await import('./sentry')).initSentry();
    expect(init.mock.calls[0][0]).toMatchObject({ release: 'sha-abc123', tracesSampleRate: 0 });
  });

  it('tags the route and status so an event is findable by either', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example/1';
    const scope = { setTag: jest.fn(), setTransactionName: jest.fn() };
    withScope.mockImplementationOnce((fn: (s: unknown) => void) => fn(scope));
    const mod = await import('./sentry');
    mod.captureServerError(new Error('boom'), { method: 'POST', path: '/orders', status: 500 });
    expect(scope.setTag).toHaveBeenCalledWith('http.method', 'POST');
    expect(scope.setTag).toHaveBeenCalledWith('http.status', '500');
    expect(scope.setTransactionName).toHaveBeenCalledWith('POST /orders');
  });

  describe('beforeSend', () => {
    beforeEach(async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.example/1';
      (await import('./sentry')).initSentry();
    });

    it('redacts the message, exactly as the chat webhook does', () => {
      const event = beforeSend({ message: 'failed for +6281234567890' }) as { message: string };
      expect(event.message).toBe('failed for [phone]');
    });

    it('redacts every exception value, not just the first', () => {
      const event = beforeSend({
        exception: {
          values: [
            { value: 'postgres://user:pw@db:5432/x refused' },
            { value: 'contact ops@hydromart.id' },
            { value: undefined },
          ],
        },
      }) as { exception: { values: { value?: string }[] } };
      expect(event.exception.values[0].value).toContain('***:***@');
      expect(event.exception.values[1].value).toBe('contact [email]');
      expect(event.exception.values[2].value).toBeUndefined();
    });

    it('drops breadcrumbs — a second copy of the request with none of the redaction', () => {
      const event = beforeSend({ breadcrumbs: [{ message: 'GET /customers?phone=+628123456789' }] }) as {
        breadcrumbs: unknown[];
      };
      expect(event.breadcrumbs).toEqual([]);
    });

    it('leaves an event with neither message nor exception alone', () => {
      expect(beforeSend({})).toEqual({ breadcrumbs: [] });
    });
  });

  it('exports initSentry for a service that wants to start it at boot', () => {
    expect(typeof initSentry).toBe('function');
    expect(typeof captureServerError).toBe('function');
  });
});
