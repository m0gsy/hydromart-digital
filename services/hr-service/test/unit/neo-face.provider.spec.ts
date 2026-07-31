import { ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../src/config/hr-config.service';
import { NeoFaceProvider } from '../../src/infrastructure/face/neo-face.provider';

const identity = { userId: 'e1', userName: 'Budi' };

function makeConfig(token = 'tok_test'): HrConfigService {
  return { neoFr: { endpoint: 'https://fr.example', token, galleryId: 'g1' } } as HrConfigService;
}

function mockFetch(
  handler: (url: string, init: RequestInit) => { ok?: boolean; status?: number; body: unknown },
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url, body });
    const r = handler(url, init);
    // NEO wraps every body under `risetai`.
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => ({ risetai: r.body }),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('NeoFaceProvider', () => {
  it('enroll creates the gallery once then posts enroll-face with the identity', async () => {
    const calls = mockFetch(() => ({ body: { status: '200' } }));
    const neo = new NeoFaceProvider(makeConfig());

    const first = await neo.enroll([Buffer.from('img')], identity);
    await neo.enroll([Buffer.from('img2')], identity);

    expect(first.vector).toEqual([]); // remote gallery holds the identity, not a local vector
    const paths = calls.map((c) => c.url);
    // gallery created exactly once, both enrolls posted
    expect(paths.filter((p) => p.endsWith('create-facegallery'))).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith('enroll-face'))).toHaveLength(2);
    const enroll = calls.find((c) => c.url.endsWith('enroll-face'))!;
    expect(enroll.body).toMatchObject({
      facegallery_id: 'g1',
      user_id: 'e1',
      user_name: 'Budi',
      force_register: true,
    });
    expect(enroll.body.image).toBe(Buffer.from('img').toString('base64'));
    expect(enroll.body.trx_id).toBeTruthy();
  });

  it('verify maps NEO verified/similarity to matched/score (percent → 0..1)', async () => {
    mockFetch(() => ({ body: { status: '200', verified: true, similarity: '92.5' } }));
    const neo = new NeoFaceProvider(makeConfig());
    const res = await neo.verify(Buffer.from('p'), [], true, identity);
    expect(res).toEqual({ score: 0.925, matched: true, live: true });
  });

  it('verify reports no match (not an error) when NEO returns 411 Face Not Verified', async () => {
    // A genuine non-match uses a non-2xx status but still carries verified:false.
    mockFetch(() => ({ status: 200, body: { status: '411', verified: false, similarity: 0 } }));
    const neo = new NeoFaceProvider(makeConfig());
    const res = await neo.verify(Buffer.from('p'), [], false, identity);
    expect(res).toEqual({ score: 0, matched: false, live: false });
  });

  it('throws ServiceUnavailable on a NEO error status', async () => {
    mockFetch(() => ({ body: { status: '400', status_message: 'face not found' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], true, identity)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws when the token is not configured', async () => {
    mockFetch(() => ({ body: {} }));
    const neo = new NeoFaceProvider(makeConfig(''));
    await expect(neo.verify(Buffer.from('p'), [], true, identity)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // NEO reports similarity as a percentage, but some deployments answer with a 0..1 fraction
  // (and an older one omits it entirely) — neither may be read as a 90% match.
  it('reads a fractional similarity as-is and a missing one as zero', async () => {
    mockFetch(() => ({ body: { status: '200', similarity: 0.42 } }));
    const fractional = await new NeoFaceProvider(makeConfig()).verify(
      Buffer.from('p'),
      [],
      true,
      identity,
    );
    expect(fractional.score).toBeCloseTo(0.42);

    mockFetch(() => ({ body: { status: '200' } }));
    const missing = await new NeoFaceProvider(makeConfig()).verify(
      Buffer.from('p'),
      [],
      true,
      identity,
    );
    expect(missing.score).toBe(0);
  });

  it('refuses to enroll with no frames at all', async () => {
    mockFetch(() => ({ body: { status: '200' } }));
    await expect(new NeoFaceProvider(makeConfig()).enroll([], identity)).rejects.toThrow(
      /no frames/,
    );
  });

  // The gallery is created once per process. An "already exists" answer is the normal second
  // boot; any other failure has to be retried rather than remembered as done.
  it('tolerates an existing gallery and retries a genuine creation failure', async () => {
    let attempts = 0;
    mockFetch((url) => {
      if (url.endsWith('create-facegallery')) {
        attempts += 1;
        return { body: { status: '400', status_message: 'facegallery already exist' } };
      }
      return { body: { status: '200' } };
    });
    const existing = new NeoFaceProvider(makeConfig());
    await existing.enroll([Buffer.from('img')], identity);
    await existing.enroll([Buffer.from('img')], identity);
    expect(attempts).toBe(1); // remembered as done

    attempts = 0;
    mockFetch((url) => {
      if (url.endsWith('create-facegallery')) {
        attempts += 1;
        return { body: { status: '500', status_message: 'internal' } };
      }
      return { body: { status: '200' } };
    });
    const broken = new NeoFaceProvider(makeConfig());
    await broken.enroll([Buffer.from('img')], identity);
    await broken.enroll([Buffer.from('img')], identity);
    expect(attempts).toBe(2); // retried on the next enroll
  });

  it('requires an identity (userId)', async () => {
    mockFetch(() => ({ body: { status: '200' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], true, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
