import { CrmConfigService } from '../../src/config/crm-config.service';
import { WhatsappBroadcastHttpAdapter } from '../../src/infrastructure/whatsapp/whatsapp-broadcast.http.adapter';

// Exercises the REAL WhatsApp Cloud API adapter: dev/console mode, the success path (leading
// '+' stripped, bearer header, timeout signal), the non-2xx branch with AND without a detail
// body, a text() that throws (the .catch fallback), and the fail-soft catch. No network.

function makeConfig(baseUrl: string, token = 't'): CrmConfigService {
  return { whatsapp: { baseUrl, token } } as unknown as CrmConfigService;
}

function res(init: { ok: boolean; status?: number; text?: () => Promise<string> }): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    text: init.text ?? (async (): Promise<string> => ''),
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('WhatsappBroadcastHttpAdapter', () => {
  it('runs in dev/console mode (reports success, no fetch) when baseUrl is blank', async () => {
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('')).send('+6281', 'hi');
    expect(out).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the Cloud API, stripping the leading + and forwarding the bearer token', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('http://wa', 'secret')).send(
      '+6281',
      'hello',
    );
    expect(out).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://wa/messages');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(opts.body as string)).toMatchObject({ to: '6281', text: { body: 'hello' } });
  });

  it('returns the WhatsApp status WITH the detail body on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, text: async () => 'bad number' }));
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('http://wa')).send('6281', 'x');
    expect(out).toEqual({ ok: false, error: 'WhatsApp responded 400: bad number' });
  });

  it('returns just the status when the error body is empty', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 429, text: async () => '' }));
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('http://wa')).send('6281', 'x');
    expect(out).toEqual({ ok: false, error: 'WhatsApp responded 429' });
  });

  it('falls back to no detail when reading the error body itself throws', async () => {
    fetchMock.mockResolvedValue(
      res({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('stream error');
        },
      }),
    );
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('http://wa')).send('6281', 'x');
    expect(out).toEqual({ ok: false, error: 'WhatsApp responded 500' });
  });

  it('fails soft (never throws) when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const out = await new WhatsappBroadcastHttpAdapter(makeConfig('http://wa')).send('6281', 'x');
    expect(out).toEqual({ ok: false, error: 'ETIMEDOUT' });
  });
});
