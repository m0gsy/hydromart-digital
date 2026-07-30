import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { INTERNAL_KEY_HEADER, InternalAuthGuard } from './internal-auth.guard';

const KEY = 'internal-key-that-is-long-enough';

const guard = (configured?: string) =>
  new InternalAuthGuard({ get: () => configured } as unknown as ConfigService);

const ctx = (headers: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

/**
 * This is the ONLY auth on every internal route (they carry `@Public()`), so each
 * branch here is a way in. All of them must land on the same rejection.
 */
describe('InternalAuthGuard', () => {
  it('admits a request carrying the configured key', () => {
    expect(guard(KEY).canActivate(ctx({ [INTERNAL_KEY_HEADER]: KEY }))).toBe(true);
  });

  // The dangerous default: an unset key must not mean "no check", or every internal
  // route on a mis-deployed service is wide open.
  it.each([
    ['no key configured', undefined, { [INTERNAL_KEY_HEADER]: KEY }],
    ['an empty configured key', '', { [INTERNAL_KEY_HEADER]: '' }],
    ['a missing header', KEY, {}],
    ['a repeated header (array)', KEY, { [INTERNAL_KEY_HEADER]: [KEY, KEY] }],
    ['a shorter key', KEY, { [INTERNAL_KEY_HEADER]: 'short' }],
    ['a longer key', KEY, { [INTERNAL_KEY_HEADER]: `${KEY}-extra` }],
    ['a same-length wrong key', KEY, { [INTERNAL_KEY_HEADER]: 'x'.repeat(KEY.length) }],
  ])('rejects %s', (_case, configured, headers) => {
    expect(() => guard(configured).canActivate(ctx(headers))).toThrow(UnauthorizedException);
  });
});
