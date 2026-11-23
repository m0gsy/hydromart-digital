import { CrmConfigService } from '../../src/config/crm-config.service';
import { CrmAuditSink } from '../../src/infrastructure/http/audit.sink';

/*
 * AI-5: crm-service's first audited route is n8n's. The row is posted to auth-service's
 * shared ingest under this service's name; the pre-write must throw when it was not stored
 * (the interceptor turns that into a 503), the outcome row must never throw.
 */
describe('CrmAuditSink', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (over: Partial<CrmConfigService> = {}) =>
    ({ authServiceUrl: 'http://auth:3001', internalServiceKey: 'internal-key', ...over }) as CrmConfigService;

  it('posts to the shared ingest with the internal key, namespaced to crm', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    global.fetch = jest.fn(async (url: string, init: never) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 201 } as never;
    }) as never;

    await new CrmAuditSink(config()).record({
      action: 'notifications.external.franchise-application-submitted.created',
      actorId: 'machine-1',
      metadata: { via: 'machine' },
    });
    await new CrmAuditSink(config()).recordOrThrow({ action: 'x.requested' });

    expect(calls.map((c) => c.url)).toEqual([
      'http://auth:3001/api/v1/auth/audit/internal',
      'http://auth:3001/api/v1/auth/audit/internal',
    ]);
    expect(calls[0]!.init.headers['x-internal-key']).toBe('internal-key');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      action: 'crm.notifications.external.franchise-application-submitted.created',
      actorId: 'machine-1',
      success: true,
      metadata: { via: 'machine' },
    });
    expect(JSON.parse(calls[1]!.init.body)).toMatchObject({ action: 'crm.x.requested' });
  });

  it('never throws for the outcome row, the change has already happened', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;
    await expect(new CrmAuditSink(config()).record({ action: 'a' })).resolves.toBeUndefined();
  });

  it('throws for the pre-write when the row was not stored or cannot be', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }) as never) as never;
    await expect(new CrmAuditSink(config()).recordOrThrow({ action: 'a' })).rejects.toThrow('500');
    await expect(
      new CrmAuditSink(config({ internalServiceKey: '' } as never)).recordOrThrow({ action: 'a' }),
    ).rejects.toThrow('not configured');
  });
});
