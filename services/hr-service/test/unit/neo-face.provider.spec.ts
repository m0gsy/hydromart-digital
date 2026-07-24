import { ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../src/config/hr-config.service';
import { NeoFaceProvider } from '../../src/infrastructure/face/neo-face.provider';

const identity = { userId: 'e1', userName: 'Budi' };

function makeConfig(token = 'tok_test'): HrConfigService {
  return { neoFr: { endpoint: 'https://fr.example', token, galleryId: 'g1' } } as HrConfigService;
}

function mockFetch(handler: (url: string, init: RequestInit) => { ok?: boolean; status?: number; body: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    calls.push({ url, body });
    const r = handler(url, init);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body } as Response;
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
    expect(enroll.body).toMatchObject({ facegallery_id: 'g1', user_id: 'e1', user_name: 'Budi', force_register: 'true' });
    expect(enroll.body.image).toBe(Buffer.from('img').toString('base64'));
    expect(enroll.body.trx_id).toBeTruthy();
  });

  it('verify maps NEO verified/similarity to matched/score (percent → 0..1)', async () => {
    mockFetch(() => ({ body: { status: '200', verified: true, similarity: '92.5' } }));
    const neo = new NeoFaceProvider(makeConfig());
    const res = await neo.verify(Buffer.from('p'), [], true, identity);
    expect(res).toEqual({ score: 0.925, matched: true, live: true });
  });

  it('verify reports no match when NEO says unverified', async () => {
    mockFetch(() => ({ body: { status: '200', verified: false, similarity: '10' } }));
    const neo = new NeoFaceProvider(makeConfig());
    const res = await neo.verify(Buffer.from('p'), [], false, identity);
    expect(res.matched).toBe(false);
    expect(res.live).toBe(false);
  });

  it('throws ServiceUnavailable on a NEO error status', async () => {
    mockFetch(() => ({ body: { status: '400', status_message: 'face not found' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], true, identity)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws when the token is not configured', async () => {
    mockFetch(() => ({ body: {} }));
    const neo = new NeoFaceProvider(makeConfig(''));
    await expect(neo.verify(Buffer.from('p'), [], true, identity)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires an identity (userId)', async () => {
    mockFetch(() => ({ body: { status: '200' } }));
    const neo = new NeoFaceProvider(makeConfig());
    await expect(neo.verify(Buffer.from('p'), [], true, undefined)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
