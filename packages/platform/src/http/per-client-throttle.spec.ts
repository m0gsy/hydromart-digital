import type { ExecutionContext } from '@nestjs/common';

import { clientIpTracker, isInternalCall, perClientThrottle } from './per-client-throttle';

/** A request as a backend service sees it: the gateway container is always the socket peer. */
const fromGateway = (forwardedFor?: string): Record<string, unknown> => ({
  headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  socket: { remoteAddress: '172.18.0.5' },
});

const ctx = (headers: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

const env = { INTERNAL_SERVICE_KEY: 'current-key', INTERNAL_SERVICE_KEY_PREVIOUS: 'old-key' };

describe('clientIpTracker', () => {
  it('keys two customers behind the same gateway differently', () => {
    expect(clientIpTracker(fromGateway('203.0.113.1'))).toBe('203.0.113.1');
    expect(clientIpTracker(fromGateway('203.0.113.2'))).toBe('203.0.113.2');
  });

  it('falls back to the socket peer when nothing was forwarded', () => {
    expect(clientIpTracker(fromGateway())).toBe('172.18.0.5');
  });

  it('ignores a forged x-forwarded-for from a public peer', () => {
    const direct = { headers: { 'x-forwarded-for': '8.8.8.8' }, socket: { remoteAddress: '198.51.100.7' } };
    expect(clientIpTracker(direct)).toBe('198.51.100.7');
  });
});

describe('isInternalCall', () => {
  it('accepts the current key and the previous one', () => {
    expect(isInternalCall(ctx({ 'x-internal-key': 'current-key' }), env)).toBe(true);
    expect(isInternalCall(ctx({ 'x-internal-key': 'old-key' }), env)).toBe(true);
  });

  it('does not let a made-up key switch the limiter off', () => {
    expect(isInternalCall(ctx({ 'x-internal-key': 'x' }), env)).toBe(false);
    expect(isInternalCall(ctx({ 'x-internal-key': '' }), env)).toBe(false);
    expect(isInternalCall(ctx({}), env)).toBe(false);
  });

  it('refuses everything when no key is configured', () => {
    expect(isInternalCall(ctx({ 'x-internal-key': 'anything' }), {})).toBe(false);
    expect(isInternalCall(ctx({ 'x-internal-key': '' }), { INTERNAL_SERVICE_KEY: '' })).toBe(false);
  });
});

describe('perClientThrottle', () => {
  it('keeps the entries the service passed and adds the tracker and the bypass', () => {
    const options = perClientThrottle([{ ttl: 60000, limit: 100 }]);
    expect(options.throttlers).toEqual([{ ttl: 60000, limit: 100 }]);
    expect(options.getTracker(fromGateway('203.0.113.9'))).toBe('203.0.113.9');
    expect(options.skipIf(ctx({}))).toBe(false);
  });
});

describe('clientIpTracker without any address', () => {
  it('still returns a stable key rather than undefined', () => {
    expect(clientIpTracker({ headers: {}, socket: {} })).toBe('unknown');
  });
});
