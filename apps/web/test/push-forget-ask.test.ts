/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), get: vi.fn(), del: vi.fn() } }));

import { forgetPushAsk } from '@/lib/push';

/**
 * The "already asked" flag belongs to the device but guards a registration that belongs to
 * the account, and sign-out deletes that registration. Left set, the next sign-in on the
 * phone was never registered.
 */
describe('forgetPushAsk', () => {
  beforeEach(() => window.localStorage.clear());

  it('clears the flag requestPushOnce sets', () => {
    window.localStorage.setItem('hm.push-asked', '1');
    forgetPushAsk();
    expect(window.localStorage.getItem('hm.push-asked')).toBeNull();
  });

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetPushAsk()).not.toThrow();
    spy.mockRestore();
  });
});
