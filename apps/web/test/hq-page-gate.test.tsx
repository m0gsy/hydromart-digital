// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The gate itself, not the map it reads.
 *
 * `hq-rail-gating.test.ts` proves the TABLE is right — which link a role is offered, which
 * capability each screen needs. This proves the ENFORCEMENT: that typing a URL for a screen
 * you were not offered is refused. Those are different failures, and step 07 of the console
 * audit found the second one on 58 of 64 /hq pages: the rail hid the link and the page
 * opened anyway, fetched, took 403s, and rendered as a broken screen rather than as a door
 * that was never yours.
 *
 * No test rendered this layout at all before now, so the two gates in it were the only
 * access rules in the console with nothing standing behind them.
 */

const { role, pathname } = vi.hoisted(() => ({ role: { current: 'HEAD_OFFICE' }, pathname: { current: '/hq' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, loading: false }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The shell around the gate is not what is under test, and both halves fetch.
vi.mock('@/components/hq/hq-rail', () => ({ HqRail: () => <nav data-testid="rail" /> }));
vi.mock('@/components/hq/hq-bottom-nav', () => ({ HqBottomNav: () => null }));
vi.mock('@/components/hq/command-palette', () => ({ CommandPalette: () => null }));

import HqLayout from '@/app/hq/layout';
import { LocaleProvider } from '@/lib/locale-context';

const open = (as: string, at: string) => {
  // Two opens in one test would otherwise stack two trees in the same document, and the
  // first one's screen would answer for the second's.
  cleanup();
  role.current = as;
  pathname.current = at;
  render(
    <LocaleProvider>
      <HqLayout>
        <p>the screen</p>
      </HqLayout>
    </LocaleProvider>,
  );
};

const shown = () => screen.queryByText('the screen') !== null;

beforeEach(() => {
  role.current = 'HEAD_OFFICE';
  pathname.current = '/hq';
});
afterEach(() => vi.clearAllMocks());

describe('the /hq page gate', () => {
  it('opens a screen to a role that holds its capability', () => {
    open('HEAD_OFFICE', '/hq/roster');
    expect(shown()).toBe(true);
  });

  it('refuses a screen inside the console that the role cannot use', () => {
    // A director is in the console and holds neither `platformAdmin` nor `staffAdmin`.
    open('DIREKTUR', '/hq/api-keys');
    expect(shown()).toBe(false);
  });

  it('refuses everyone who is not in the console at all', () => {
    open('KEPALA_DEPOT', '/hq');
    expect(shown()).toBe(false);
  });

  it('applies the parent screen rule to a detail route', () => {
    // `/hq/staff/import` has its own row; anything deeper inherits the nearest one rather
    // than falling through as the one unguarded way in.
    open('DIREKTUR', '/hq/staff/import');
    expect(shown()).toBe(false);
    open('HEAD_OFFICE', '/hq/staff/import');
    expect(shown()).toBe(true);
  });

  it('lets FINANCE at its money screens and nothing else', () => {
    open('FINANCE', '/hq/payments');
    expect(shown()).toBe(true);
    open('FINANCE', '/hq/depots');
    expect(shown()).toBe(false);
  });

  it('renders the sign-in door bare, outside both gates', () => {
    // /hq/login is how somebody with no session gets in; gating it would lock the console
    // behind itself.
    open('CUSTOMER', '/hq/login');
    expect(shown()).toBe(true);
    expect(screen.queryByTestId('rail')).toBeNull();
  });
});
