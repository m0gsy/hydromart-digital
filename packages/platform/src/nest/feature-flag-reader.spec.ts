import { httpFeatureFlagReader } from './feature-flag-reader';

describe('httpFeatureFlagReader', () => {
  const originalFetch = global.fetch;
  let clock = 1_000;
  const now = () => clock;
  const cfg = { adminServiceUrl: 'http://admin:3017/', now };
  const respond = (rows: unknown) => {
    const f = jest.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify(rows)));
    global.fetch = f as unknown as typeof fetch;
    return f;
  };

  beforeEach(() => {
    clock = 1_000;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('answers from the public list and caches it for the ttl', async () => {
    const f = respond([
      { key: 'payments.cash_on_delivery', enabled: false },
      { key: 'recommendations.ai', enabled: true },
      { notAKey: 1 },
    ]);
    const reader = httpFeatureFlagReader(cfg);

    expect(await reader.isEnabled('payments.cash_on_delivery')).toBe(false);
    expect(await reader.isEnabled('recommendations.ai')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe('http://admin:3017/api/v1/feature-flags/public');

    clock += 30_001;
    await reader.isEnabled('recommendations.ai');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('is enabled for a key nobody created', async () => {
    respond([]);
    expect(await httpFeatureFlagReader(cfg).isEnabled('subscriptions.galon')).toBe(true);
  });

  // The fail-open contract: head office's console being down must not stop checkout.
  it.each([
    ['unconfigured', { now }],
    ['unreachable', cfg],
    ['refusing', cfg],
  ])('fails OPEN when admin-service is %s', async (mode, c) => {
    global.fetch = jest.fn(async () => {
      if (mode === 'refusing') return new Response('no', { status: 500 });
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const reader = httpFeatureFlagReader(c);
    expect(await reader.isEnabled('payments.cash_on_delivery')).toBe(true);
    if (mode === 'unconfigured') expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps the last good snapshot through an outage and retries soon', async () => {
    const f = respond([{ key: 'subscriptions.galon', enabled: false }]);
    const reader = httpFeatureFlagReader(cfg);
    expect(await reader.isEnabled('subscriptions.galon')).toBe(false);

    f.mockImplementation(async () => {
      throw new Error('down');
    });
    // (typed loosely: the helper's mock resolves Responses, this one rejects)
    clock += 30_001;
    expect(await reader.isEnabled('subscriptions.galon')).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);

    // Not re-asked inside the retry window, re-asked after it.
    await reader.isEnabled('subscriptions.galon');
    expect(f).toHaveBeenCalledTimes(2);
    clock += 10_001;
    await reader.isEnabled('subscriptions.galon');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const f = respond([{ key: 'a', enabled: false }]);
    const reader = httpFeatureFlagReader(cfg);
    await Promise.all([reader.isEnabled('a'), reader.isEnabled('a'), reader.isEnabled('a')]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('uses the default clock and ttl when none is given', async () => {
    respond([{ key: 'a', enabled: false }]);
    expect(await httpFeatureFlagReader({ adminServiceUrl: 'http://x' }).isEnabled('a')).toBe(false);
  });

  it('aborts a hung lookup and fails open', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_u, init) =>
        new Promise((_r, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => reject(new Error('abort')));
        }),
    ) as unknown as typeof fetch;
    const p = httpFeatureFlagReader(cfg).isEnabled('a');
    await jest.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe(true);
    jest.useRealTimers();
  });
});
