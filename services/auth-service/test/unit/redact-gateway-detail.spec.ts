import { redactGatewayDetail } from '../../src/infrastructure/otp-delivery/redact-gateway-detail';

/*
 * AUTH-6. Both SMS adapters logged the gateway's failure body verbatim, and these gateways
 * echo what they were sent: the destination number, and in Zenziva's case the message text —
 * which contains the code. A bad afternoon at the provider wrote live OTP codes and customer
 * phone numbers into a log ops reads and the deploy tails.
 */
describe('redactGatewayDetail', () => {
  it('removes the code and the destination it was just handed', () => {
    const body = 'invalid destination +6281234567890 for message "Kode Hydromart: 482913"';
    const out = redactGatewayDetail(body, { code: '482913', phone: '+6281234567890' });

    expect(out).not.toContain('482913');
    expect(out).not.toContain('6281234567890');
    // What the log is FOR survives: the gateway's own complaint.
    expect(out).toContain('invalid destination');
  });

  it('removes a number the gateway reformatted on its way back', () => {
    const out = redactGatewayDetail('rejected: 0812-3456-7890 unreachable', {
      phone: '+6281234567890',
    });
    expect(out).not.toContain('3456');
    expect(out).toContain('unreachable');
  });

  it('caps a body that arrives as a whole HTML error page', () => {
    const out = redactGatewayDetail('x'.repeat(5000));
    expect(out.length).toBeLessThan(400);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary short complaint alone', () => {
    expect(redactGatewayDetail('quota exceeded')).toBe('quota exceeded');
    expect(redactGatewayDetail('')).toBe('');
  });

  // A two-character "code" would blank half the message; a secret that short is not one.
  it('ignores a secret too short to be one', () => {
    expect(redactGatewayDetail('err 42 at node', { code: '42' })).toBe('err 42 at node');
  });
});
