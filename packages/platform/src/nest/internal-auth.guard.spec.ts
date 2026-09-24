import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { INTERNAL_KEY_HEADER, InternalAuthGuard } from './internal-auth.guard';

const KEY = 'internal-key-that-is-long-enough';
const PREVIOUS_KEY = 'previous-internal-key-long-enough';

const guard = (current?: string, previous?: string) =>
  new InternalAuthGuard({
    get: (name: string) =>
      name === 'INTERNAL_SERVICE_KEY_PREVIOUS' ? previous : name === 'INTERNAL_SERVICE_KEY' ? current : undefined,
  } as unknown as ConfigService);

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

  /*
   * PLAT-5. A rotation window: ops has moved the old value into `_PREVIOUS` and put a new
   * one in `INTERNAL_SERVICE_KEY`, and every one of the other sixteen services has not
   * redeployed yet — their calls still carry the old key.
   */
  describe('rotation (INTERNAL_SERVICE_KEY_PREVIOUS)', () => {
    it('admits the current key during a rotation window', () => {
      const g = guard(KEY, PREVIOUS_KEY);
      expect(g.canActivate(ctx({ [INTERNAL_KEY_HEADER]: KEY }))).toBe(true);
    });

    it('ALSO admits the previous key during a rotation window', () => {
      const g = guard(KEY, PREVIOUS_KEY);
      expect(g.canActivate(ctx({ [INTERNAL_KEY_HEADER]: PREVIOUS_KEY }))).toBe(true);
    });

    it('rejects a key that is neither current nor previous', () => {
      const g = guard(KEY, PREVIOUS_KEY);
      expect(() => g.canActivate(ctx({ [INTERNAL_KEY_HEADER]: 'x'.repeat(KEY.length) }))).toThrow(
        UnauthorizedException,
      );
    });

    // No rotation in progress: an unset _PREVIOUS must not itself be treated as a key that
    // matches an unset/blank header — the blank-vs-blank trap every branch above guards.
    it('an unset previous key never matches a blank header', () => {
      const g = guard(KEY);
      expect(() => g.canActivate(ctx({ [INTERNAL_KEY_HEADER]: '' }))).toThrow(UnauthorizedException);
    });
  });
});
