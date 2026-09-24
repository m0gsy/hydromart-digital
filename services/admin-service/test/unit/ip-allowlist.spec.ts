import { ipAllowed } from '../../src/domain/ip-allowlist';

/*
 * ADM-6. The allowlist was written on the HQ security screen, stored by admin-service, and
 * evaluated by NOTHING — the page's own note called that "the same lie in a smaller font".
 */
describe('ipAllowed', () => {
  it('lets everything through when the list is empty, as it always has', () => {
    expect(ipAllowed('203.0.113.7', [])).toBe(true);
    expect(ipAllowed(null, [])).toBe(true);
  });

  it('matches an exact address', () => {
    expect(ipAllowed('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(ipAllowed('203.0.113.8', ['203.0.113.7'])).toBe(false);
  });

  it('matches inside a CIDR range and refuses outside it', () => {
    expect(ipAllowed('203.0.113.55', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
  });

  it('reads an IPv4-mapped address as the address it maps to', () => {
    expect(ipAllowed('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true);
  });

  it('handles the edges of prefix length', () => {
    expect(ipAllowed('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
    expect(ipAllowed('1.2.3.4', ['1.2.3.4/32'])).toBe(true);
    expect(ipAllowed('1.2.3.5', ['1.2.3.4/32'])).toBe(false);
  });

  // An allowlist that cannot be evaluated refuses; it does not wave the caller through.
  it('refuses when the caller has no address at all', () => {
    expect(ipAllowed(null, ['203.0.113.0/24'])).toBe(false);
  });

  it('ignores entries that are not addresses rather than throwing', () => {
    expect(ipAllowed('203.0.113.7', ['not-an-ip', '203.0.113.7'])).toBe(true);
    expect(ipAllowed('203.0.113.7', ['203.0.113.0/99', ''])).toBe(false);
    expect(ipAllowed('203.0.113.7', ['999.0.0.1/24'])).toBe(false);
    // Neither side is four octets: a truncated network, and a truncated caller address.
    expect(ipAllowed('203.0.113.7', ['203.0.113/24'])).toBe(false);
    expect(ipAllowed('203.0.113', ['203.0.113.0/24'])).toBe(false);
  });
});
