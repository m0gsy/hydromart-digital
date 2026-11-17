// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'MANAGER',
  depot: { depots: [] as { id: string }[], ready: true, error: null as string | null },
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/m/manager' }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: state.role } }) }));
vi.mock('@/lib/depot-context', () => ({ useDepot: () => state.depot }));

import { NoDepotScopeNotice } from '@/components/dashboard/all-depots-notice';

/*
 * A manager with no placement depot and no supervision chain opened the phone console and
 * every tab was blank, with nothing saying why. The notice names the cause once, for every
 * role whose depots come from a link, and stays quiet where an empty list means something
 * else.
 */
describe('NoDepotScopeNotice', () => {
  beforeEach(() => {
    state.role = 'MANAGER';
    state.depot = { depots: [], ready: true, error: null };
  });

  it.each(['MANAGER', 'SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT'])(
    'tells a %s with no depots that the account is not linked',
    (role) => {
      state.role = role;
      render(<NoDepotScopeNotice />);
      expect(screen.getByRole('alert').textContent).toContain('ops.switcher.noScopeBody');
    },
  );

  it('tells a franchise owner to contact head office instead', () => {
    state.role = 'FRANCHISE_OWNER';
    render(<NoDepotScopeNotice />);
    expect(screen.getByRole('alert').textContent).toContain('ops.switcher.noScopeOwner');
  });

  it('says nothing to an unscoped role: an empty network is a different message', () => {
    state.role = 'HEAD_OFFICE';
    render(<NoDepotScopeNotice />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says nothing when the list failed to load, or has not loaded yet, or has depots', () => {
    state.depot = { depots: [], ready: true, error: 'HTTP 429' };
    const { rerender } = render(<NoDepotScopeNotice />);
    expect(screen.queryByRole('alert')).toBeNull();

    state.depot = { depots: [], ready: false, error: null };
    rerender(<NoDepotScopeNotice />);
    expect(screen.queryByRole('alert')).toBeNull();

    state.depot = { depots: [{ id: 'd1' }], ready: true, error: null };
    rerender(<NoDepotScopeNotice />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
