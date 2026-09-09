import { ConfigService } from '@nestjs/config';

import { PayoutConfigService } from '../../src/config/payout-config.service';
import { PhotoLinkHttpAdapter } from '../../src/infrastructure/http/photo-link.http.adapter';

/**
 * CA-4-49, step 3 — the receipt a reviewer approves money against.
 *
 * The receipt is uploaded through the courier app into delivery-service's bucket, so this
 * service holds the URL and none of the credentials. That bucket is private now, so the
 * stored string opens nothing: the money screen showed a dead image where the proof should
 * be.
 *
 * Every failure here answers null rather than throwing, and that is the whole design: a
 * reviewer's claim list must still load when delivery-service is down. A missing picture is
 * a screen that says "no receipt"; an exception would be a stopped payout queue.
 */

const STORED = 'https://cdn.example.com/pod/abc.jpg';

function adapter(env: Record<string, string>) {
  const config = new PayoutConfigService(
    new ConfigService({ DELIVERY_SERVICE_URL: '', INTERNAL_SERVICE_KEY: '', ...env }),
    // The settings cache is not consulted by either getter this adapter reads.
    {} as never,
  );
  return new PhotoLinkHttpAdapter(config);
}

describe('CA-4-49 PhotoLinkHttpAdapter', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const configured = {
    DELIVERY_SERVICE_URL: 'http://delivery:3006/',
    INTERNAL_SERVICE_KEY: 'k'.repeat(16),
  };

  it('asks delivery-service, with the internal key and the stored url', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://signed/a' }) });

    await expect(adapter(configured).signedUrl(STORED)).resolves.toBe('https://signed/a');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The trailing slash on the configured base is trimmed, or the path doubles it.
    expect(url).toBe('http://delivery:3006/api/v1/proofs/photo-link');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('k'.repeat(16));
    expect(JSON.parse(String(init.body))).toEqual({ url: STORED });
  });

  it('answers null when the peer says it cannot sign that url', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: null }) });
    await expect(adapter(configured).signedUrl(STORED)).resolves.toBeNull();
  });

  it('answers null on a refusal, without throwing at the money screen', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(adapter(configured).signedUrl(STORED)).resolves.toBeNull();
  });

  it('answers null when the peer is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter(configured).signedUrl(STORED)).resolves.toBeNull();
  });

  it.each([
    ['no url configured', { INTERNAL_SERVICE_KEY: 'k'.repeat(16) }],
    ['no internal key', { DELIVERY_SERVICE_URL: 'http://delivery:3006' }],
  ])('asks nothing at all with %s', async (_label, env) => {
    await expect(adapter(env).signedUrl(STORED)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
