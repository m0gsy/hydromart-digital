import {
  assertSendableWebhookUrl,
  defaultAddressLookup,
  isBlockedAddress,
  WebhookDestinationBlockedError,
} from '../../src/domain/safe-webhook-url';

const publicLookup = async () => [{ address: '203.0.113.10' }];
const privateLookup = async () => [{ address: '10.0.0.7' }];

/*
 * ADM-1. The partner registers the URL and this service POSTs to it from INSIDE the docker
 * network, with no address check and fetch's default redirect-following. So the endpoint's
 * owner could point us at `http://order:3004`, at localhost, or at the cloud metadata
 * service on 169.254.169.254 — and read the answer back out of the delivery's own
 * `responseStatus` and `lastError`.
 */
describe('assertSendableWebhookUrl', () => {
  it('allows an ordinary partner endpoint', async () => {
    await expect(
      assertSendableWebhookUrl('https://partner.example/hooks/orders', publicLookup),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['a service on the docker network', 'http://order:3004/api/v1/orders'],
    ['localhost', 'http://localhost:9090/metrics'],
    ['a loopback literal', 'http://127.0.0.1/admin'],
    ['the cloud metadata service', 'http://169.254.169.254/latest/meta-data/'],
    ['an RFC1918 literal', 'http://10.0.0.7/'],
    ['a link-local v6 literal', 'http://[fe80::1]/'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['something that is not a URL at all', 'order:3004'],
  ])('refuses %s', async (_label, url) => {
    await expect(assertSendableWebhookUrl(url, publicLookup)).rejects.toBeInstanceOf(
      WebhookDestinationBlockedError,
    );
  });

  // The classic rebind: a public name whose A record points inside. Only resolution finds it.
  it('refuses a public hostname that resolves to a private address', async () => {
    await expect(
      assertSendableWebhookUrl('https://partner.example/hook', privateLookup),
    ).rejects.toThrow(/10\.0\.0\.7/);
  });

  it('fails closed when the name does not resolve or resolves to nothing', async () => {
    const boom = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertSendableWebhookUrl('https://gone.example/h', boom)).rejects.toThrow(
      /does not resolve/,
    );
    await expect(
      assertSendableWebhookUrl('https://empty.example/h', async () => []),
    ).rejects.toThrow(/no address/);
  });
});

describe('defaultAddressLookup', () => {
  // The resolver both callers actually use in production. `localhost` needs no network and
  // proves the shape the rest of this file mocks.
  it('resolves a hostname to addresses', async () => {
    const addresses = await defaultAddressLookup('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every((a) => isBlockedAddress(a.address))).toBe(true);
  });
});

describe('isBlockedAddress', () => {
  it.each(['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '::1', 'fd00::1', '100.64.0.1'])(
    'blocks %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    },
  );

  it.each(['203.0.113.10', '8.8.8.8', '172.32.0.1', '2001:db8::1'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
