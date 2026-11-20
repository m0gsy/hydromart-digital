import {
  personalDataSourcesProvider,
  RemotePersonalDataSource,
} from '../../src/infrastructure/http/remote-personal-data.source';

/** P4: the export reads the services that hold a copy of the person, as the erasure writes them. */
describe('RemotePersonalDataSource', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts the subject with the internal key and returns what the owner holds', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 's1' }] });
    global.fetch = fetchMock as never;
    const source = new RemotePersonalDataSource('subscriptions', 'http://order', '/api/x', 'key');

    await expect(source.collect({ customerId: 'c1', phone: '+628111' })).resolves.toEqual([
      { id: 's1' },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://order/api/x');
    expect(init).toMatchObject({ method: 'POST', headers: { 'x-internal-key': 'key' } });
    expect(JSON.parse(init.body)).toEqual({ customerId: 'c1', phone: '+628111' });
  });

  it('throws on a refusal, and when it is not configured, so the export can name the gap', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(
      new RemotePersonalDataSource('deliveries', 'http://d', '/x', 'k').collect({
        customerId: 'c1',
        phone: null,
      }),
    ).rejects.toThrow('deliveries: owner responded 503');
    await expect(
      new RemotePersonalDataSource('deliveries', '', '/x', 'k').collect({ customerId: 'c1', phone: null }),
    ).rejects.toThrow('not configured');
  });

  it('builds one source per service from the config', () => {
    const factory = (personalDataSourcesProvider as { useFactory: (c: unknown) => { section: string }[] })
      .useFactory;
    const sources = factory({ serviceUrl: (k: string) => `http://${k}`, internalServiceKey: 'k' });
    expect(sources.map((s) => s.section)).toEqual(['subscriptions', 'deliveries']);
  });
});
