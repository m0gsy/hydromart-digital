import { validateSync } from 'class-validator';

import { IsPublicHttpsUrl } from './public-url.validator';

class WebhookDto {
  @IsPublicHttpsUrl()
  url!: unknown;
}

const check = (url: unknown): boolean => {
  const dto = new WebhookDto();
  dto.url = url;
  return validateSync(dto).length === 0;
};

/**
 * This is an SSRF gate on a URL the platform itself will call, so the interesting
 * cases are all the ways an attacker gets a request aimed back at the cluster or at
 * the cloud metadata endpoint.
 */
describe('IsPublicHttpsUrl', () => {
  it.each([
    'https://partner.example.com/hooks',
    'https://sub.domain.co.id/a/b?c=1',
    'https://203.0.113.10/hook',
  ])('accepts the public https url %s', (url) => {
    expect(check(url)).toBe(true);
  });

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['a schemeless value', 'partner.example.com/hooks'],
    ['a relative path', '/hooks'],
    ['plain http', 'http://partner.example.com/hooks'],
    ['a non-web scheme', 'file:///etc/passwd'],
    ['a bare host with no dot', 'https://intranet/hook'],
  ])('rejects %s', (_case, url) => {
    expect(check(url)).toBe(false);
  });

  it.each([
    ['localhost', 'https://localhost/hook'],
    ['a .localhost suffix', 'https://api.localhost/hook'],
    ['a .internal suffix', 'https://payments.internal/hook'],
    ['IPv4 loopback', 'https://127.0.0.1/hook'],
    ['0.0.0.0/8', 'https://0.0.0.0/hook'],
    ['RFC-1918 10/8', 'https://10.1.2.3/hook'],
    ['RFC-1918 172.16/12', 'https://172.20.0.5/hook'],
    ['RFC-1918 192.168/16', 'https://192.168.1.1/hook'],
    ['CGNAT 100.64/10', 'https://100.100.0.1/hook'],
    ['IPv6 loopback', 'https://[::1]/hook'],
    ['IPv6 unspecified', 'https://[::]/hook'],
    ['IPv6 unique-local', 'https://[fd00:1234::1]/hook'],
    ['IPv6 link-local', 'https://[fe80::1]/hook'],
  ])('rejects %s as a private host', (_case, url) => {
    expect(check(url)).toBe(false);
  });

  // The one that actually gets exploited: the AWS/GCP instance metadata address.
  it('rejects the cloud metadata endpoint', () => {
    expect(check('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  // A dotted-quad with an out-of-range octet is not a public address, it is a typo or
  // an evasion attempt. Refuse rather than guess what it meant.
  it('rejects a malformed dotted-quad', () => {
    expect(check('https://999.1.1.1/hook')).toBe(false);
  });

  // 172.15 and 172.32 sit OUTSIDE RFC-1918 — the range check must not over-block.
  it.each(['https://172.15.0.1/hook', 'https://172.32.0.1/hook', 'https://100.63.0.1/hook'])(
    'still accepts %s, just outside the private range',
    (url) => {
      expect(check(url)).toBe(true);
    },
  );

  it('explains itself in the rejection message', () => {
    const dto = new WebhookDto();
    dto.url = 'http://localhost/hook';
    expect(Object.values(validateSync(dto)[0].constraints ?? {})[0]).toContain('https absolut');
  });
});
