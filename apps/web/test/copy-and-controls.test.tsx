// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Five customer-facing screens that said the wrong thing, or nothing.
 *
 *  - CA-3-39: two OPTIONAL fields, one wearing the border /login puts on its `required` one.
 *  - CA-3-47: a copy button that reported neither success nor failure.
 *  - CA-3-70: <Link><Button> — one action, two tab stops, a control inside a control.
 *  - CA-3-68: a 34px tap target under a 44px house floor used 112 times elsewhere.
 *  - CA-3-36: the gateway's 429 carried no `code`, so an Indonesian screen printed
 *    "Too many requests". Covered in the gateway's own spec — the body is server-side.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/referral-rules', () => ({
  useReferralRules: () => ({ data: { referrerPoints: 50, refereePoints: 25 } }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import RegisterPage from '@/app/register/page';
import ReferralPage from '@/app/referral/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ code: { code: 'HYD-ABC' }, invited: 0, earned: 0 });
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('CA-3-39 the register form says which fields are optional', () => {
  it('names both optional fields as optional', () => {
    const { container } = render(<RegisterPage />, { wrapper: LocaleProvider });
    // Asked per-label rather than page-wide: the referral field's own label already ends in
    // "(opsional)", so a page-wide count moves for the wrong reason and is not an assertion.
    const labelFor = (id: string): string => container.querySelector('label[for="' + id + '"]')?.textContent ?? '';
    expect(labelFor('fullName')).toMatch(/opsional/i);
    expect(labelFor('email')).toMatch(/opsional/i);
    expect(labelFor('phone')).not.toMatch(/opsional/i);
  });

  it('keeps the required-field border for the one required field only', () => {
    const { container } = render(<RegisterPage />, { wrapper: LocaleProvider });
    const name = container.querySelector('#fullName')!;
    const email = container.querySelector('#email')!;
    // `border-2 border-brand-600` is what /login puts on the field it marks `required`.
    // Two optional fields must not disagree about whether they are optional.
    expect(name.className).not.toContain('border-2');
    expect(name.className).toBe(email.className);
  });
});

describe('CA-3-47 the referral copy button answers', () => {
  it('confirms a copy that worked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ReferralPage />, { wrapper: LocaleProvider });

    const btn = await screen.findByRole('button', { name: /salin kode/i });
    await userEvent.click(btn);

    expect(writeText).toHaveBeenCalledWith('HYD-ABC');
    // The label is the feedback: an icon-only button has nowhere else to say it.
    await waitFor(() => expect(screen.getByRole('button', { name: /tersalin/i })).toBeTruthy());
  });

  it('stays quiet — and does not claim success — when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ReferralPage />, { wrapper: LocaleProvider });

    const btn = await screen.findByRole('button', { name: /salin kode/i });
    await userEvent.click(btn);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // Still the original label: a blocked clipboard must not read as a successful copy.
    expect(screen.getByRole('button', { name: /salin kode/i })).toBeTruthy();
  });
});

/*
 * CA-3-70 and CA-3-68 are structural facts about the rendered markup, and both were
 * defects of KIND rather than of a single screen: three <Link><Button> pairs and two
 * undersized tap targets. Asserted over the source so the sweep cannot quietly shrink
 * back to the one site each row happened to name.
 */
describe('CA-3-70 no control is nested inside another control', () => {
  it('has no <Link> wrapping a <Button> anywhere in the app', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const p = join(dir, e);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
      });

    // Comments are stripped first. The obvious version of this scan flagged the very
    // comments explaining the fix — prose containing `<Link><Button>` is not markup, the
    // same false positive the conflict-marker gate had to learn.
    const strip = (src: string): string =>
      src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const offenders = walk('src').filter((f) =>
      /<Link[^>]*>\s*<Button/.test(strip(readFileSync(f, 'utf8'))),
    );
    // An <a> containing a <button> is two tab stops for one action, and a screen reader
    // announces a link that contains a button. `LinkButton` renders one element instead.
    expect(offenders).toEqual([]);
  });
});

describe('CA-3-68 every add-to-cart tap target clears the house floor', () => {
  it('uses h-11 (44px), not the 34px and 40px these two shipped with', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/app/products/detail/page.tsx', 'src/components/product-card.tsx']) {
      const src = readFileSync(f, 'utf8');
      const button = src.slice(src.indexOf('shop.card.addAria'));
      const cls = button.slice(0, button.indexOf('>'));
      // `min-h-11`/`h-11` is 44px and is this repo's own floor — 112 other places use it.
      expect(cls).toMatch(/h-11 w-11/);
      expect(cls).not.toMatch(/h-\[(34|36|40)px\]|h-10 w-10/);
    }
  });
});
