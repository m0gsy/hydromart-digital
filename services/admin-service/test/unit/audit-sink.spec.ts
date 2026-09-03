import { AdminAuditSink } from '../../src/infrastructure/http/audit.sink';
import { AdminConfigService } from '../../src/config/admin-config.service';

/**
 * CA-2-67: admin-service had no audit client at all, while the ingest endpoint it needed
 * had been live since H-29. The proof is the HTTP request — that one is made, that it
 * carries the internal key, and that a trail which is down cannot break the change that
 * was already applied.
 */
describe('AdminAuditSink (CA-2-67)', () => {
  const config = (over: Partial<AdminConfigService> = {}) =>
    ({
      authServiceUrl: 'http://auth:3001',
      internalServiceKey: 'internal-key',
      ...over,
    }) as AdminConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('posts to the shared ingest, namespaced to this service', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    global.fetch = jest.fn(async (url: string, init: never) => {
      calls.push({ url: String(url), init: init as never });
      return { ok: true, status: 200 } as never;
    }) as never;

    await new AdminAuditSink(config()).record({
      action: 'api-keys.rotate',
      actorId: 'u-1',
      target: 'key-9',
      metadata: { environment: 'PROD' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://auth:3001/api/v1/auth/audit/internal');
    expect(calls[0].init.headers['x-internal-key']).toBe('internal-key');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      // The prefix is what tells a reader of the shared trail which service decided this.
      action: 'admin.api-keys.rotate',
      actorId: 'u-1',
      target: 'key-9',
      success: true,
      metadata: { environment: 'PROD' },
    });
  });

  it('does not throw when the trail is unreachable — the key has already rotated', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    await expect(
      new AdminAuditSink(config()).record({ action: 'api-keys.deleted' }),
    ).resolves.toBeUndefined();
  });

  it('stays silent when the ingest is not configured', async () => {
    global.fetch = jest.fn() as never;
    await new AdminAuditSink(config({ authServiceUrl: '' } as never)).record({
      action: 'webhooks.created',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
