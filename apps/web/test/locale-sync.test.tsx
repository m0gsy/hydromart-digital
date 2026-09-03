// @vitest-environment jsdom
/**
 * K5.3 — the language belongs to the person, not to the phone.
 *
 * Found in a browser, not in code: a signed-in customer whose stored locale is `en` opened
 * `/orders` on a device with no local key and got `<html lang="id">` with an Indonesian nav,
 * while the same person's order notification rendered in English (crm-service reads
 * `notification_preferences.locale`; the browser did not). The adoption existed — it lived
 * inside `/account`, beside the fetch that happens to load preferences there — so it fired
 * only if the second device visited that one screen.
 *
 * These pin the behaviour app-wide and, just as importantly, pin the three cases that must
 * NOT trigger a read: a device that has already answered, a staff role with no row of its
 * own, and a signed-out visitor.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, setLocale } = vi.hoisted(() => ({ get: vi.fn(), setLocale: vi.fn() }));
let customer: { id: string; role: string } | null = null;
let ready = true;

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready }) }));
vi.mock('@/lib/locale-context', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/locale-context')>('@/lib/locale-context');
  return { ...actual, useT: () => ({ t: (k: string) => k, locale: 'id', setLocale }) };
});

import { LocaleSync } from '@/components/locale-sync';
import { LOCALE_STORAGE_KEY } from '@/lib/locale-context';

beforeEach(() => {
  localStorage.clear();
  get.mockReset().mockResolvedValue({ locale: 'en' });
  setLocale.mockReset();
  customer = { id: 'c1', role: 'CUSTOMER' };
  ready = true;
});
afterEach(() => vi.clearAllMocks());

describe('K5.3 · a device that has never been asked adopts the stored language', () => {
  it('reads the row and applies it, on any screen', async () => {
    render(<LocaleSync />);
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('en'));
  });

  it('leaves a device that has already answered alone', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'id');
    render(<LocaleSync />);
    await new Promise((r) => setTimeout(r, 30));
    // The switch flipped on THIS device must not be undone by the server's older copy.
    expect(get).not.toHaveBeenCalled();
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('does not ask on behalf of staff — the row is the customer’s', async () => {
    customer = { id: 's1', role: 'MANAGER' };
    render(<LocaleSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(get).not.toHaveBeenCalled();
  });

  it('asks nothing while signed out', async () => {
    customer = null;
    render(<LocaleSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(get).not.toHaveBeenCalled();
  });

  it('ignores a value that is not a locale, and never throws on a failed read', async () => {
    get.mockReset().mockResolvedValue({ locale: 'klingon' });
    render(<LocaleSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(setLocale).not.toHaveBeenCalled();

    setLocale.mockReset();
    localStorage.clear();
    get.mockReset().mockRejectedValue(new Error('offline'));
    render(<LocaleSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(setLocale).not.toHaveBeenCalled();
  });
});
