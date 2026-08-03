import { alertServerError } from './error-alerter';

/**
 * Alerting sits on the 5xx path, so its own failure modes matter more than its
 * happy path: it must never throw, never await, and never flood a channel.
 */
describe('alertServerError', () => {
  const env = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    process.env.SERVICE_NAME = 'order-service';
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
    delete process.env.ALERT_DEDUPE_SECONDS;
  });

  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const alert = (over: Partial<Parameters<typeof alertServerError>[0]> = {}) =>
    alertServerError({
      method: 'GET',
      path: `/api/v1/orders/${Math.random()}`,
      status: 500,
      exception: new Error('boom'),
      ...over,
    });

  it('does nothing at all when no webhook is configured', () => {
    delete process.env.ALERT_WEBHOOK_URL;
    alert();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts one payload carrying both a Slack and a Discord field', () => {
    alert({ path: '/api/v1/orders/1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
      content: string;
    };
    expect(body.text).toBe(body.content);
    expect(body.text).toContain('order-service');
    expect(body.text).toContain('HTTP 500');
    expect(body.text).toContain('boom');
  });

  // Same route + same error class = one alert per window. Without this a crash loop
  // writes hundreds of identical messages and buries everything else in the channel.
  it('throttles a repeat of the same route and error class', () => {
    alert({ path: '/api/v1/same' });
    alert({ path: '/api/v1/same' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still alerts for a DIFFERENT error class on the same route', () => {
    alert({ path: '/api/v1/dup', exception: new TypeError('a') });
    alert({ path: '/api/v1/dup', exception: new RangeError('b') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours ALERT_DEDUPE_SECONDS, and ignores a nonsense value', () => {
    process.env.ALERT_DEDUPE_SECONDS = '0';
    alert({ path: '/api/v1/zero' });
    alert({ path: '/api/v1/zero' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // falls back to the 60s default

    process.env.ALERT_DEDUPE_SECONDS = 'not-a-number';
    alert({ path: '/api/v1/nan' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A real window: the second alert only gets through once it has elapsed. Fake timers,
    // not a 10ms sleep — the dedupe reads Date.now(), so a runner that stalled between the
    // two calls let the "throttled" one through and failed the run on nothing.
    jest.useFakeTimers();
    process.env.ALERT_DEDUPE_SECONDS = '0.01';
    alert({ path: '/api/v1/short' });
    alert({ path: '/api/v1/short' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(20);
    alert({ path: '/api/v1/short' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('falls back to the message when an Error carries no stack', () => {
    const err = new Error('no stack here');
    err.stack = undefined;
    alert({ path: '/api/v1/nostack', exception: err });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
    };
    expect(body.text).toContain('no stack here');
  });

  it('falls back to the hostname when SERVICE_NAME is unset', () => {
    delete process.env.SERVICE_NAME;
    alert({ path: '/api/v1/anon' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
    };
    expect(body.text).toMatch(/\*\S+\*/);
  });

  it('stringifies a thrown non-Error rather than dropping the alert', () => {
    alert({ path: '/api/v1/weird', exception: { nope: true } });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
    };
    expect(body.text).toContain('object Object');
  });

  // A dead webhook host must not surface as an unhandled rejection on the 5xx path.
  it('swallows a webhook failure', async () => {
    fetchMock.mockRejectedValue(new Error('webhook down'));
    expect(() => alert({ path: '/api/v1/deadhook' })).not.toThrow();
    await Promise.resolve();
  });

  it('clears the dedupe map instead of growing without bound', () => {
    for (let i = 0; i < 520; i += 1) alert({ path: `/api/v1/p${i}` });
    expect(fetchMock).toHaveBeenCalledTimes(520);
  });
});
