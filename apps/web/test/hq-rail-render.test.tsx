// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The rail, rendered.
 *
 * `hq-rail-gating.test.ts` asks the nav model which links a role should get; this asks the
 * component whether it draws them. They were the same test until step 07b split the model
 * out of the component — and the split quietly left the component itself loaded by nothing,
 * which is its own answer to "is this navigation still built at all".
 *
 * It is also the only place the console's own chrome is exercised: the sign-out, the theme
 * toggle, the locale switch and the ⌘K hint all live here and are what a head-office
 * account looks at all day.
 */

const { role, pathname } = vi.hoisted(() => ({
  role: { current: 'HEAD_OFFICE' },
  pathname: { current: '/hq' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, loading: false }),
}));
vi.mock('@/components/console-sign-out', () => ({
  ConsoleSignOut: () => <button type="button">Keluar</button>,
}));

// jsdom ships no `matchMedia`, and ThemeProvider reads the OS colour-scheme through it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

import { HqRail } from '@/components/hq/hq-rail';
import { hqItemsForRole } from '@/lib/hq-nav';
import { LocaleProvider } from '@/lib/locale-context';
import { ThemeProvider } from '@/lib/theme-context';

const draw = (as: string, at = '/hq') => {
  cleanup();
  role.current = as;
  pathname.current = at;
  render(
    <ThemeProvider>
      <LocaleProvider>
        <HqRail />
      </LocaleProvider>
    </ThemeProvider>,
  );
};

/** Every href the rail actually put on screen. */
const drawn = () =>
  Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  role.current = 'HEAD_OFFICE';
  pathname.current = '/hq';
});
afterEach(() => cleanup());

describe('HqRail', () => {
  it('draws exactly the links the model allows the role', () => {
    draw('HEAD_OFFICE');
    const expected = hqItemsForRole('HEAD_OFFICE').map((i) => i.href);
    // Not a subset check: a link the model withheld and the rail drew anyway is the same
    // defect as one it withheld and never drew, pointing the other way.
    expect(drawn().sort()).toEqual([...expected].sort());
  });

  it('draws a director fewer doors than head office, and FINANCE fewer still', () => {
    draw('HEAD_OFFICE');
    const headOffice = drawn().length;
    draw('DIREKTUR');
    const direktur = drawn().length;
    draw('FINANCE');
    const finance = drawn().length;

    expect(direktur).toBeLessThan(headOffice);
    expect(finance).toBeLessThan(direktur);
    expect(finance).toBeGreaterThan(0);
    // The seven money screens FINANCE was let in for.
    expect(drawn()).toContain('/hq/payments');
    expect(drawn()).toContain('/hq/refunds');
  });

  it('marks the screen you are on, and only that one', () => {
    draw('HEAD_OFFICE', '/hq/payments');
    const active = Array.from(document.querySelectorAll('a[aria-current="page"]'));
    expect(active.map((a) => a.getAttribute('href'))).toEqual(['/hq/payments']);
  });

  it('does not treat the overview as active on every screen', () => {
    // `/hq` is a prefix of all of them, so a `startsWith` match would light it up forever.
    draw('HEAD_OFFICE', '/hq/refunds');
    const active = Array.from(document.querySelectorAll('a[aria-current="page"]'));
    expect(active.map((a) => a.getAttribute('href'))).not.toContain('/hq');
  });

  it('carries the console chrome a signed-in operator needs', () => {
    draw('HEAD_OFFICE');
    expect(screen.getByRole('button', { name: /Keluar/ })).toBeTruthy();
  });

  it('draws nothing at all for somebody the console does not admit', () => {
    draw('KEPALA_DEPOT');
    expect(drawn()).toEqual([]);
  });
});
