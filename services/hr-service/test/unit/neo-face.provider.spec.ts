import { ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../src/config/hr-config.service';
import { NeoFaceProvider } from '../../src/infrastructure/face/neo-face.provider';

const identity = { userId: 'e1', userName: 'Budi' };

function makeConfig(token = 'tok_test'): HrConfigService {
  return {
    neoFr: { endpoint: 'https://fr.example', token, galleryId: 'g1' },
    neoLiveness: { mode: 'off', path: '/liveness' },
  } as unknown as HrConfigService;
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
  // A provider that accepts the connection and never answers must not pin the caller.
  it('every NEO call carries a timeout', async () => {
    const signals: unknown[] = [];
    mockFetch((_url, init) => {
      signals.push(init.signal);
      return { body: { status: '200' } };
    });
    await new NeoFaceProvider(makeConfig()).enroll([Buffer.from('img')], identity);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

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
    const res = await neo.verify(Buffer.from('p'), [], identity);
    expect(res).toEqual({ score: 0.925, matched: true });
  });

  it('verify reports no match (not an error) when NEO returns 411 Face Not Verified', async () => {
    // A genuine non-match uses a non-2xx status but still carries verified:false.
    mockFetch(() => ({ status: 200, body: { status: '411', verified: false, similarity: 0 } }));
    const neo = new NeoFaceProvider(makeConfig());
    const res = await neo.verify(Buffer.from('p'), [], identity);
    expect(res).toEqual({ score: 0, matched: false });
  });

  it('throws ServiceUnavailable on a NEO error status', async () => {
    mockFetch(() => ({ body: { status: '400', status_message: 'face not found' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws when the token is not configured', async () => {
    mockFetch(() => ({ body: {} }));
    const neo = new NeoFaceProvider(makeConfig(''));
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(
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
      identity,
    );
    expect(fractional.score).toBeCloseTo(0.42);

    mockFetch(() => ({ body: { status: '200' } }));
    const missing = await new NeoFaceProvider(makeConfig()).verify(
      Buffer.from('p'),
      [],
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
    await expect(neo.verify(Buffer.from('p'), [], undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('NeoFaceProvider liveness', () => {
  const withLiveness = (mode: 'off' | 'shadow' | 'enforce') =>
    ({
      neoFr: { endpoint: 'https://fr.example', token: 'tok', galleryId: 'g1' },
      neoLiveness: { mode, path: '/risetai/liveness-api/verify-face-liveness' },
    }) as unknown as HrConfigService;

  it('asks nothing when off, and reports no verdict', async () => {
    const calls = mockFetch(() => ({ body: { status: '200', verified: true, similarity: '90' } }));
    const res = await new NeoFaceProvider(withLiveness('off')).verify(Buffer.from('p'), [], identity);
    expect(calls).toHaveLength(1);
    expect(res.live).toBeUndefined();
  });

  it('shadow asks, never blocks, and swallows a failing liveness call', async () => {
    const calls = mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '200', results: { is_spoof: true } } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const spoof = await new NeoFaceProvider(withLiveness('shadow')).verify(Buffer.from('p'), [], identity);
    // The call was made, but the verdict does not reach the caller.
    expect(calls.some((c) => c.url.includes('liveness-api'))).toBe(true);
    expect(spoof.matched).toBe(true);
    expect(spoof.live).toBeUndefined();

    mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '500', status_message: 'boom' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const down = await new NeoFaceProvider(withLiveness('shadow')).verify(Buffer.from('p'), [], identity);
    expect(down).toMatchObject({ matched: true });
    expect(down.live).toBeUndefined();
  });

  it('marks a real face live and sends spoof_detection on the same frame', async () => {
    const calls = mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '200', match_status: { is_real: true }, results: { is_spoof: false } } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const res = await new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity);
    expect(res.live).toBe(true);
    const live = calls.find((c) => c.url.includes('liveness-api'))!;
    expect(live.body).toMatchObject({ user_id: 'e1', face_parameters: { spoof_detection: true } });
    expect(live.body.image).toBe(Buffer.from('p').toString('base64'));
  });

  it('marks a spoof not live, and treats a missing is_real as not live', async () => {
    mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '200', results: { is_spoof: true } } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    expect((await new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity)).live).toBe(false);
    mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '200' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    expect((await new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity)).live).toBe(false);
  });

  it('fails closed when the liveness call errors, and skips it for a non-match', async () => {
    mockFetch((url) =>
      url.includes('liveness-api')
        ? { body: { status: '500', status_message: 'boom' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    await expect(
      new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const calls = mockFetch(() => ({ body: { status: '200', verified: false, similarity: '10' } }));
    const res = await new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity);
    expect(res.matched).toBe(false);
    expect(calls.filter((c) => c.url.includes('liveness-api'))).toHaveLength(0);
  });

  it('fails closed on a transport error and on a missing token (liveness and the plain call)', async () => {
    // The match succeeds, then the liveness request itself cannot be made.
    let n = 0;
    global.fetch = (async () => {
      n += 1;
      if (n === 1) {
        return { ok: true, status: 200, json: async () => ({ risetai: { status: '200', verified: true, similarity: '90' } }) } as Response;
      }
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // A plain gallery call whose request never leaves the box.
    global.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(withLiveness('off')).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when the token vanishes, and when the answer is not JSON at all', async () => {
    // verify() reads the token once, checkLiveness() again: the second read finds none.
    let reads = 0;
    const flaky = {
      get neoFr() {
        reads += 1;
        return { endpoint: 'https://fr.example', token: reads === 1 ? 'tok' : '', galleryId: 'g1' };
      },
      neoLiveness: { mode: 'enforce', path: '/liveness' },
    } as unknown as HrConfigService;
    mockFetch(() => ({ body: { status: '200', verified: true, similarity: '90' } }));
    await expect(new NeoFaceProvider(flaky).verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // The liveness answer is not JSON: no `risetai`, so no 2xx status -> unavailable, not "live".
    let n = 0;
    global.fetch = (async () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        json: async () => {
          if (n === 1) return { risetai: { status: '200', verified: true, similarity: '90' } };
          throw new Error('not json');
        },
      } as Response;
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(withLiveness('enforce')).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
