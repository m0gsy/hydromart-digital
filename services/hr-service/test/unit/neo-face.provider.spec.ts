import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';
import {
  FaceEngineUnavailableError,
  FaceNotEnrolledError,
  FaceReplaceFailedError,
} from '../../src/application/ports/face-verifier.port';
import { NeoFaceProvider } from '../../src/infrastructure/face/neo-face.provider';

jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));

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

  // Production 2026-10-20: "Database Error - UserID Already Exists" on every re-enroll by an
  // employee who already had a face. `force_register` does not replace the user.
  it('re-enrolls an existing user by deleting them first, then enrolling again', async () => {
    let enrolls = 0;
    const calls = mockFetch((url) => {
      if (url.endsWith('enroll-face')) {
        enrolls += 1;
        return enrolls === 1
          ? { body: { status: '400', status_message: 'Database Error - UserID Already Exists' } }
          : { body: { status: '200' } };
      }
      return { body: { status: '200' } };
    });

    await new NeoFaceProvider(makeConfig()).enroll([Buffer.from('img')], identity);

    const order = calls.map((c) => c.url.split('/').pop());
    expect(order.filter((p) => p === 'enroll-face')).toHaveLength(2);
    const del = calls.find((c) => c.url.endsWith('delete-face'))!;
    expect(del.body).toMatchObject({ facegallery_id: 'g1', user_id: 'e1' });
    expect(order.indexOf('delete-face')).toBeGreaterThan(order.indexOf('enroll-face'));
    expect(order.lastIndexOf('enroll-face')).toBeGreaterThan(order.indexOf('delete-face'));
  });

  it('does not loop: a second refusal after the delete is the answer', async () => {
    const calls = mockFetch((url) =>
      url.endsWith('enroll-face')
        ? { body: { status: '400', status_message: 'Database Error - UserID Already Exists' } }
        : { body: { status: '200' } },
    );

    const failed = new NeoFaceProvider(makeConfig())
      .enroll([Buffer.from('img')], identity)
      .catch((e: unknown) => e);
    // The old face is already deleted: said as such, with the refusal itself inside, so HR
    // retires its enrolment instead of keeping one NEO no longer holds (2026-11-21).
    const err = (await failed) as FaceReplaceFailedError;
    expect(err).toBeInstanceOf(FaceReplaceFailedError);
    expect(err.refusal).toBeInstanceOf(ServiceUnavailableException);
    expect(calls.filter((c) => c.url.endsWith('enroll-face'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.endsWith('delete-face'))).toHaveLength(1);
  });

  it('a different enroll failure is not retried and does not delete anybody', async () => {
    const calls = mockFetch((url) =>
      url.endsWith('enroll-face')
        ? { body: { status: '400', status_message: 'No face detected' } }
        : { body: { status: '200' } },
    );

    await expect(
      new NeoFaceProvider(makeConfig()).enroll([Buffer.from('img')], identity),
    ).rejects.toThrow(/No face detected/);
    expect(calls.some((c) => c.url.endsWith('delete-face'))).toBe(false);
  });

  it('remove deletes the user from the gallery', async () => {
    const methods: string[] = [];
    const calls = mockFetch((_url, init) => {
      methods.push(String(init.method));
      return { body: { status: '200' } };
    });
    await new NeoFaceProvider(makeConfig()).remove(identity);
    // The live gateway refuses POST on this route with 405; only DELETE reaches the gallery.
    expect(methods).toEqual(['DELETE']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith('delete-face')).toBe(true);
    expect(calls[0].body).toMatchObject({ facegallery_id: 'g1', user_id: 'e1' });
  });

  it('remove treats a user that is not in the gallery as already deleted', async () => {
    // The exact answer the live gateway gave for an unknown user_id, 2026-10-20.
    mockFetch(() => ({ body: { status: '416', status_message: 'Database Error - UserID Not Found' } }));
    await expect(new NeoFaceProvider(makeConfig()).remove(identity)).resolves.toBeUndefined();
  });

  it('remove surfaces any other refusal, and a missing identity', async () => {
    mockFetch(() => ({ body: { status: '500', status_message: 'Database Error' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.remove(identity)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(neo.remove({ userId: '', userName: '' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // NEO has answered with an empty body before (a gateway page that parses as `{}`): no status,
  // no message. That is a failure in both directions, never a silent success.
  it('treats an empty NEO answer as a failure for enroll and for remove', async () => {
    mockFetch(() => ({ body: {} }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.enroll([Buffer.from('img')], identity)).rejects.toThrow(/enroll-face/);
    await expect(neo.remove(identity)).rejects.toThrow(/delete-face: unknown error/);
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

  it('a frame with no detectable face is a 400 the employee can retry, not a 503', async () => {
    mockFetch(() => ({
      body: {
        status: '413',
        status_message: 'Procedural Error - Face Not Detected: please check image clarity',
      },
    }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(
      BadRequestException,
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

/*
 * Review of #927. Attendance holds a punch for HR only on `FaceEngineUnavailableError`, so this
 * class must mean "the engine could not be asked" and nothing else: never a frame the employee
 * controls (that would let a garbage image skip the face check), never a misconfiguration (that
 * must page), and never an enforced liveness that could not run (that is fail-closed).
 */
describe('NeoFaceProvider: engine down vs everything else', () => {
  const verifyWith = (body: unknown, status = 200) => {
    mockFetch(() => ({ status, body }));
    return new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity);
  };

  it('the spent quota and a 5xx gateway are the engine being down', async () => {
    await expect(
      verifyWith({ status: '401', status_message: 'Not authorized: max api hit limit reached!' }),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    await expect(verifyWith({}, 502)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it("NEO's in-band 500 pages instead: one bad frame must not hold everyone's punch", async () => {
    await expect(verifyWith({ status: '500', status_message: 'Server error' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      verifyWith({ status: '500', status_message: 'Server error' }),
    ).rejects.not.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it('a request that never got an answer is the engine being down', async () => {
    global.fetch = (async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it('a frame NEO cannot read is a retake (400), never the engine being down', async () => {
    for (const status of ['451', '490', '493', '495']) {
      await expect(verifyWith({ status, status_message: 'image error' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('an account NEO refuses (401/403, any wording) is down; a token we never set is ours and pages', async () => {
    await expect(
      verifyWith({ status: '401', status_message: 'Accestoken not authorized' }),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    await expect(
      verifyWith({ status: '403', status_message: 'API usage exceeded for this token' }),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    await expect(
      new NeoFaceProvider(makeConfig('')).verify(Buffer.from('p'), [], identity),
    ).rejects.not.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it('an enforced liveness that cannot be asked is the engine being down, like any other call', async () => {
    mockFetch((url) =>
      url.includes('liveness')
        ? { body: { status: '401', status_message: 'max api hit limit reached!' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const enforce = {
      neoFr: { endpoint: 'https://fr.example', token: 'tok', galleryId: 'g1' },
      neoLiveness: { mode: 'enforce', path: '/liveness' },
    } as unknown as HrConfigService;
    // Attendance holds it for HR with no score (owner, 2026-11-18): never accepted on the match.
    await expect(
      new NeoFaceProvider(enforce).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it('a host that does not resolve is NEO unreachable too, and the reason names the code', async () => {
    global.fetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toThrow(/ENOTFOUND/);
  });
});

describe('NeoFaceProvider: a down engine is not asked again for a minute', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-18T08:00:00Z') }));
  afterEach(() => jest.useRealTimers());

  it('fails fast without calling NEO, then lets one call probe it', async () => {
    const calls = mockFetch(() => ({ body: { status: '401', status_message: 'Not authorized: max api hit limit reached!' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(calls).toHaveLength(1);

    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(calls).toHaveLength(1); // the spent quota is not spent again

    jest.advanceTimersByTime(61_000);
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(calls).toHaveLength(2);
  });

  it('an answer of any kind ends it at once', async () => {
    let quota = true;
    const calls = mockFetch(() =>
      quota
        ? { body: { status: '401', status_message: 'max api hit limit reached!' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    jest.advanceTimersByTime(61_000);
    quota = false;
    expect((await neo.verify(Buffer.from('p'), [], identity)).matched).toBe(true);
    expect((await neo.verify(Buffer.from('p'), [], identity)).matched).toBe(true);
    expect(calls).toHaveLength(3);
  });
});


describe('NeoFaceProvider: review round 3 of #927', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-18T09:00:00Z') }));
  afterEach(() => jest.useRealTimers());

  it('a lapsed NEO certificate and a 429 rate limit are NEO being down', async () => {
    global.fetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    }) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);

    mockFetch(() => ({ status: 429, body: {} }));
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
  });

  it('a failing liveness call (its own API) does not shut the gallery for a minute', async () => {
    const shadow = {
      neoFr: { endpoint: 'https://fr.example', token: 'tok', galleryId: 'g1' },
      neoLiveness: { mode: 'shadow', path: '/liveness' },
    } as unknown as HrConfigService;
    const calls = mockFetch((url) =>
      url.includes('liveness')
        ? { status: 502, body: {} }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const neo = new NeoFaceProvider(shadow);
    expect((await neo.verify(Buffer.from('p'), [], identity)).matched).toBe(true);
    expect((await neo.verify(Buffer.from('p'), [], identity)).matched).toBe(true);
    expect(calls.filter((c) => !c.url.includes('liveness'))).toHaveLength(2);
  });

  it('when the minute is up, one call probes and the others still fail fast', async () => {
    let release: () => void = () => undefined;
    let fetches = 0;
    global.fetch = (async () => {
      fetches += 1;
      if (fetches === 1) {
        return { ok: true, status: 200, json: async () => ({ risetai: { status: '401', status_message: 'max api hit limit reached!' } }) } as Response;
      }
      await new Promise<void>((r) => (release = r)); // the probe hangs until released
      return { ok: true, status: 200, json: async () => ({ risetai: { status: '200', verified: true, similarity: '90' } }) } as Response;
    }) as unknown as typeof fetch;
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);

    jest.advanceTimersByTime(61_000);
    const probe = neo.verify(Buffer.from('p'), [], identity);
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(fetches).toBe(2); // the second punch did not queue on NEO behind the probe
    release();
    expect((await probe).matched).toBe(true);
  });
});

describe('NeoFaceProvider: one alert per outage, from the one place that knows', () => {
  const alert = alertServerError as jest.Mock;
  beforeEach(() => {
    alert.mockClear();
    jest.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
  });
  afterEach(() => jest.useRealTimers());

  it('one slow frame is not an outage: three unanswered calls in a row are', async () => {
    let fetches = 0;
    global.fetch = (async () => {
      fetches += 1;
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    const neo = new NeoFaceProvider(makeConfig());
    for (let i = 0; i < 2; i += 1) {
      await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    }
    expect(alert).not.toHaveBeenCalled();
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]?.[0]?.exception)).toMatch(/PENDING/);
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(fetches).toBe(3); // the fourth failed fast
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('an answer in between starts the count again', async () => {
    let n = 0;
    global.fetch = (async () => {
      n += 1;
      if (n === 3) {
        return { ok: true, status: 200, json: async () => ({ risetai: { status: '200', verified: true, similarity: '90' } }) } as Response;
      }
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const neo = new NeoFaceProvider(makeConfig());
    for (let i = 0; i < 5; i += 1) await neo.verify(Buffer.from('p'), [], identity).catch(() => undefined);
    expect(alert).not.toHaveBeenCalled(); // 2 down, 1 answer, 2 down: never 3 in a row
  });

  it('a probe that still meets the spent quota neither logs a recovery nor alerts again', async () => {
    mockFetch(() => ({ body: { status: '401', status_message: 'Not authorized: max api hit limit reached!' } }));
    const neo = new NeoFaceProvider(makeConfig());
    const log = jest.spyOn((neo as unknown as { logger: { log: (m: string) => void } }).logger, 'log');
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    for (let minute = 0; minute < 3; minute += 1) {
      jest.advanceTimersByTime(61_000);
      await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    }
    expect(alert).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/answering again/));
  });

  it('the spent quota alerts at once; the recovery is logged and the next outage alerts again', async () => {
    let quota = true;
    mockFetch(() =>
      quota
        ? { body: { status: '401', status_message: 'Not authorized: max api hit limit reached!' } }
        : { body: { status: '200', verified: true, similarity: '90' } },
    );
    const neo = new NeoFaceProvider(makeConfig());
    const log = jest.spyOn((neo as unknown as { logger: { log: (m: string) => void } }).logger, 'log');
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(alert).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(61_000);
    quota = false;
    expect((await neo.verify(Buffer.from('p'), [], identity)).matched).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/answering again/));

    quota = true;
    await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(alert).toHaveBeenCalledTimes(2);
  });
});

describe('NeoFaceProvider: a body that is not an answer (review round 6)', () => {
  const alert = alertServerError as jest.Mock;
  beforeEach(() => alert.mockClear());

  it('an HTML maintenance page is NEO down, not an answer that refuses the punch', async () => {
    global.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) as unknown as Response) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
  });

  // 2026-11-20 23:33: HTTP 400 to create-facegallery and enroll-face, and the alert said only that.
  it('says what the unreadable answer was: the JSON it sent, or that it was not JSON', async () => {
    global.fetch = (async () =>
      ({ ok: false, status: 400, json: async () => ({ message: 'Bad Request' }) }) as unknown as Response) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toThrow('jawaban NEO tidak terbaca (HTTP 400, {"message":"Bad Request"})');
    global.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) as unknown as Response) as unknown as typeof fetch;
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toThrow('(HTTP 200, bukan JSON)');
  });

  it('the gateway refusing the token (HTTP 401) is an account refusal: down at once, one alert', async () => {
    mockFetch(() => ({ ok: false, status: 401, body: {} }));
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

/*
 * 2026-11-21 08:05: 32 check-ins answered 503 "verify-face: Database Error - UserID Not Found",
 * and hr-service paged at 42.5% 5xx. NEO had dropped faces it verified the day before; the
 * employees read an engine error, and the ones who re-enrolled could punch again at once.
 */
describe('NeoFaceProvider: a face its gallery does not hold', () => {
  const alert = alertServerError as jest.Mock;
  beforeEach(() => alert.mockClear());

  it('is the enrolment being gone, not NEO down: every punch is asked, ops told once an hour', async () => {
    const calls = mockFetch(() => ({
      body: { status: '416', status_message: 'Database Error - UserID Not Found' },
    }));
    const neo = new NeoFaceProvider(makeConfig());
    for (let i = 0; i < 4; i += 1) {
      const refused = neo.verify(Buffer.from('p'), [], identity);
      await expect(refused).rejects.toBeInstanceOf(FaceNotEnrolledError);
      await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    }
    // No fail-fast minute: each punch reached NEO.
    expect(calls).toHaveLength(4);
    // One notice, not four: many at once is NEO losing its gallery, one is someone to re-enrol.
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatchObject({ status: 404 });
    expect(String(alert.mock.calls[0][0].exception.message)).toContain('employee e1');

    // An hour on, the next one is told again, with the count since.
    const later = Date.now() + 61 * 60_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await expect(neo.verify(Buffer.from('p'), [], identity)).rejects.toBeInstanceOf(FaceNotEnrolledError);
    } finally {
      now.mockRestore();
    }
    expect(alert).toHaveBeenCalledTimes(2);
    expect(String(alert.mock.calls[1][0].exception.message)).toContain('for 4 punch(es)');
  });

  it('knows the answer by its status too, whatever the wording', async () => {
    mockFetch(() => ({ body: { status: '416', status_message: 'User_ID does not exist' } }));
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.toBeInstanceOf(FaceNotEnrolledError);
  });

  it('a missing gallery is still a misconfiguration that pages (503)', async () => {
    mockFetch(() => ({ body: { status: '415', status_message: 'Facegallery Not Found' } }));
    await expect(
      new NeoFaceProvider(makeConfig()).verify(Buffer.from('p'), [], identity),
    ).rejects.not.toBeInstanceOf(FaceNotEnrolledError);
  });
});
