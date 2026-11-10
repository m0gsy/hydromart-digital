import * as http from 'node:http';
import { AddressInfo } from 'node:net';

import { pinnedFetch, pinnedLookup } from '../../src/infrastructure/http/pinned-fetch';
import { resolveSendableWebhookUrl } from '../../src/domain/safe-webhook-url';

/*
 * AAS-15. The destination check validated an address, then `fetch` resolved the name again to
 * connect, so a rebinding record could answer a public address the first time and 10.x the second.
 * The send now connects to the VALIDATED address while the URL keeps the partner's hostname.
 */
describe('pinnedFetch', () => {
  let server: http.Server;
  let port: number;
  let seen: { host?: string; method?: string; body: string }[];
  let respond: (res: http.ServerResponse) => void;

  beforeEach(async () => {
    seen = [];
    respond = (res) => res.writeHead(200).end('ok');
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ host: req.headers.host, method: req.method, body });
        respond(res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const send = (url: string, pin: { address: string; family: 4 | 6 } | null, signal?: AbortSignal) =>
    pinnedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', signal }, pin);

  it('connects to the pinned address even though the hostname resolves nowhere, keeping the Host header', async () => {
    // `partner.invalid` cannot resolve: reaching the server proves the connection used the pin, not DNS.
    const out = await send(`http://partner.invalid:${port}/hooks`, { address: '127.0.0.1', family: 4 });
    expect(out).toEqual({ ok: true, status: 200 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ host: `partner.invalid:${port}`, method: 'POST', body: '{"a":1}' });
  });

  it('without a pin a name that does not resolve fails (the pin is what made it reach the server)', async () => {
    await expect(send(`http://partner.invalid:${port}/hooks`, null)).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('a literal address needs no pin', async () => {
    const out = await send(`http://127.0.0.1:${port}/hooks`, null);
    expect(out.status).toBe(200);
  });

  it('reports a non-2xx as not ok, and never follows a redirect', async () => {
    respond = (res) => res.writeHead(500).end();
    expect(await send(`http://partner.invalid:${port}/x`, { address: '127.0.0.1', family: 4 })).toEqual({ ok: false, status: 500 });
    respond = (res) => res.writeHead(302, { Location: 'http://169.254.169.254/latest' }).end();
    expect(await send(`http://partner.invalid:${port}/x`, { address: '127.0.0.1', family: 4 })).toEqual({ ok: false, status: 302 });
    expect(seen).toHaveLength(2); // the metadata address was never contacted
  });

  it('is bounded by the abort signal', async () => {
    respond = () => undefined; // never answers
    const ctl = new AbortController();
    const p = send(`http://partner.invalid:${port}/slow`, { address: '127.0.0.1', family: 4 }, ctl.signal);
    setTimeout(() => ctl.abort(), 50);
    await expect(p).rejects.toThrow();
  });
});

describe('resolveSendableWebhookUrl', () => {
  it('returns the first validated address of a name, so the send can be pinned to it', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }];
    expect(await resolveSendableWebhookUrl('https://partner.example.com/h', lookup)).toEqual({ address: '93.184.216.34', family: 4 });
    const v6 = async () => [{ address: '2606:2800:220:1:248:1893:25c8:1946' }];
    expect(await resolveSendableWebhookUrl('https://partner.example.com/h', v6)).toMatchObject({ family: 6 });
  });

  it('returns null for a literal address and still refuses a private one', async () => {
    const never = async () => {
      throw new Error('not called');
    };
    expect(await resolveSendableWebhookUrl('https://93.184.216.34/h', never)).toBeNull();
    await expect(resolveSendableWebhookUrl('https://10.0.0.5/h', never)).rejects.toThrow(/refused/);
  });
});

describe('pinnedLookup and the https path', () => {
  it('answers the pinned address in both shapes the resolver can be asked for', () => {
    const lookup = pinnedLookup({ address: '203.0.113.10', family: 4 });
    const one = jest.fn();
    lookup('h', {}, one);
    expect(one).toHaveBeenCalledWith(null, '203.0.113.10', 4);
    const all = jest.fn();
    lookup('h', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '203.0.113.10', family: 4 }]);
  });

  it('uses https for an https URL (a refused connection is an error, not a hang)', async () => {
    await expect(
      pinnedFetch('https://partner.invalid:1/h', { method: 'POST', headers: {}, body: '{}' }, { address: '127.0.0.1', family: 4 }),
    ).rejects.toThrow();
  });
});

describe('resolveSendableWebhookUrl · refusals', () => {
  it('refuses something that is not a URL and a protocol other than http(s)', async () => {
    const never = async () => [];
    await expect(resolveSendableWebhookUrl('not a url', never)).rejects.toThrow(/not a URL/);
    await expect(resolveSendableWebhookUrl('ftp://partner.example.com/x', never)).rejects.toThrow(/protocol/);
  });
});
