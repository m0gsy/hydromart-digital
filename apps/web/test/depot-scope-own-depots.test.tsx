// @vitest-environment jsdom
/**
 * CA-2-15 / CA-4-07 / CA-4-08 / CA-4-09 — the console acts on the SIGNED-IN account's depot.
 *
 * Every staff console built its depot switcher from `GET /depots` — the anonymous, paginated
 * directory of the whole network. Nothing in that list belongs to the person reading it, so
 * `scopedId` (the selection, or the first row) was the network's first depot, and every
 * depot-scoped screen underneath asked for that depot until the API refused it. The mobile
 * manager console had no switcher at all, so it never got off that first depot: its approval
 * queue was permanently somebody else's queue, and its team tab filtered a roster it had
 * asked for without a depot with an id that was not its own.
 *
 * These pin the three halves of the fix that a revert would undo silently: the list comes
 * from the scope route, a stored selection outside that list is ignored rather than passed
 * on, and the mobile roster names its depot in the REQUEST.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/m/manager/team',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: 'MANAGER', fullName: 'Rina', assignedDepotId: 'depot-mine' },
    ready: true,
  }),
}));

import TeamPage from '@/app/m/manager/team/page';
import { DepotProvider, useDepot } from '@/lib/depot-context';
import { LocaleProvider } from '@/lib/locale-context';
import { setDepot } from '@/lib/depot-store';

const MINE = { id: 'depot-mine', code: 'DM', name: 'Depot Saya', active: true };
const ALSO_MINE = { id: 'depot-two', code: 'D2', name: 'Depot Dua', active: true };

function Probe() {
  const { depots, scopedId, ready } = useDepot();
  return (
    <div>
      <span data-testid="scoped">{ready ? (scopedId ?? 'none') : 'loading'}</span>
      <span data-testid="count">{depots.length}</span>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setDepot(null);
  get.mockReset().mockImplementation((path: string) => {
    if (path.includes('/depots/scope')) return Promise.resolve([MINE, ALSO_MINE]);
    if (path.includes('/auth/drivers')) {
      return Promise.resolve([
        { id: 'k1', fullName: 'Kurir Satu', phone: '0811', status: 'ACTIVE', assignedDepotId: MINE.id },
      ]);
    }
    return Promise.resolve([]);
  });
});
afterEach(() => vi.clearAllMocks());

describe('depot scope comes from the account, not from the network directory', () => {
  it('builds the switcher from /depots/scope and never from the public browse', async () => {
    render(
      <LocaleProvider>
        <DepotProvider>
          <Probe />
        </DepotProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    const asked = get.mock.calls.map(([path]) => String(path));
    expect(asked.some((p) => p.includes('/depots/scope'))).toBe(true);
    // The anonymous network directory — the old source — must not be what a console reads.
    expect(asked.some((p) => /\/depots(\?|$)/.test(p))).toBe(false);
    expect(screen.getByTestId('scoped').textContent).toBe(MINE.id);
  });

  it('ignores a stored selection that is not in this account’s scope', async () => {
    // The selection outlives a sign-out, so the next person on the same phone inherits it.
    setDepot('depot-of-somebody-else');

    render(
      <LocaleProvider>
        <DepotProvider>
          <Probe />
        </DepotProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('scoped').textContent).toBe(MINE.id);
  });

  it('asks for the courier roster of ITS depot, and offers a depot switcher on the phone', async () => {
    const { ManagerShell } = await import('@/components/manager-mobile/manager-shell');
    render(
      <LocaleProvider>
        <DepotProvider>
          <ManagerShell>
            <TeamPage />
          </ManagerShell>
        </DepotProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getByText('Kurir Satu')).toBeTruthy());
    const roster = get.mock.calls.map(([path]) => String(path)).filter((p) => p.includes('/auth/drivers'));
    expect(roster).toHaveLength(1);
    expect(roster[0]).toContain(`depotId=${MINE.id}`);

    // CA-4-09: two depots in scope and no way to change depot is how the second one became
    // unreachable from a phone.
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Depot Dua' })).toBeTruthy();
  });
});
