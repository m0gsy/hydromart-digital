import { alertServerError, redactAlertText } from './error-alerter';
import { captureServerError } from './sentry';

// Without the DSN `captureServerError` returns immediately, so the real module cannot show
// whether it was CALLED — which is the whole question below.
jest.mock('./sentry', () => ({ captureServerError: jest.fn() }));
const captured = captureServerError as jest.Mock;

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

  it('aborts a webhook that accepts the connection and never answers', () => {
    alert({ path: '/api/v1/slowhook' });
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // H-21: the destination is a third-party chat webhook. What reaches it must be
  // actionable, not disclosive.
  it('strips secrets, credentials and PII out of the stack it posts', () => {
    const err = new Error(
      'connect failed postgres://hydromart:s3cr3t@db:5432/hydromart for +6281234567890 ' +
        '(budi@example.com) x-internal-key: aVeryLongInternalServiceKeyValue123456',
    );
    err.stack = `${err.message}\n    at handler (/app/services/order-service/dist/main.js:1:1)`;
    alert({ path: '/api/v1/leaky', exception: err });

    const { text } = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
    };
    expect(text).not.toContain('s3cr3t');
    expect(text).not.toContain('aVeryLongInternalServiceKeyValue123456');
    expect(text).not.toContain('6281234567890');
    expect(text).not.toContain('budi@example.com');
    expect(text).not.toContain('/app/');
    // Still worth waking someone for: the failure is legible.
    expect(text).toContain('connect failed');
    expect(text).toContain('services/order-service/dist/main.js');
  });
});

describe('the health probe must not spend the Sentry quota', () => {
  // The dedupe key is `service|method path|errorName` and the map lives for the whole process,
  // so two tests posting the same shape would throttle the second and it would read as "the
  // webhook was skipped". A unique service per test keeps each one measuring itself.
  let n = 0;
  beforeEach(() => {
    captured.mockClear();
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: true });
    n += 1;
    process.env.SERVICE_NAME = `probe-svc-${n}`;
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/abc';
  });

  /*
   * `/health` is polled every 30s by the Docker healthcheck and again by Prometheus, across 18
   * services. Reporting each 503 aggregates nothing — it multiplies one known cause by several
   * hundred and buries every real exception under it. This happened: the first
   * ServiceUnavailableException in this project's Sentry came from a health controller.
   */
  it('does not send a health 503 to Sentry', () => {
    alertServerError({
      method: 'GET',
      path: '/api/v1/health',
      status: 503,
      exception: new Error('Service Unavailable Exception'),
    });
    expect(captured).not.toHaveBeenCalled();
  });

  it('still tells a human, once, through the throttled webhook', () => {
    // Dropped from the aggregator is not dropped from view. If this ever stops being true,
    // the change above became suppression instead of de-duplication.
    alertServerError({
      method: 'GET',
      path: '/api/v1/health',
      status: 503,
      exception: new Error('Service Unavailable Exception'),
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a 500 from the SAME path — a bug in a health controller is still a bug', () => {
    alertServerError({
      method: 'GET',
      path: '/api/v1/health',
      status: 500,
      exception: new Error('cannot read properties of undefined'),
    });
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('sends a 503 from a path that is not a health probe', () => {
    // The narrowness is the safety. A real endpoint answering 503 is an outage customers feel.
    alertServerError({
      method: 'POST',
      path: '/api/v1/orders',
      status: 503,
      exception: new Error('upstream unavailable'),
    });
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it.each(['/health', '/api/v1/health', '/health/', '/api/v1/health?verbose=1'])(
    'treats %s as a probe',
    (path) => {
      alertServerError({ method: 'GET', path, status: 503, exception: new Error('down') });
      expect(captured).not.toHaveBeenCalled();
    },
  );

  it('does not treat a path that merely CONTAINS health as a probe', () => {
    alertServerError({
      method: 'GET',
      path: '/api/v1/health-reports/latest',
      status: 503,
      exception: new Error('down'),
    });
    expect(captured).toHaveBeenCalledTimes(1);
  });
});

describe('redactAlertText', () => {
  it('keeps only the first frames, so a 40-frame stack cannot page a whole channel', () => {
    const long = [
      'Error: boom',
      ...Array.from({ length: 40 }, (_, i) => `    at f${i} (a.js:1:1)`),
    ];
    expect(redactAlertText(long.join('\n')).split('\n')).toHaveLength(6);
  });

  it('leaves an ordinary message alone', () => {
    expect(redactAlertText('Error: order 8f2 not found')).toBe('Error: order 8f2 not found');
  });

  it('does not mistake a timestamp for a phone number', () => {
    expect(redactAlertText('failed at 2026-08-05 10:11:12')).toContain('2026-08-05');
  });
});
