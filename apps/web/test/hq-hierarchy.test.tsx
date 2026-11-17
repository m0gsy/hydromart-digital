// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, put, del } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, put, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'SUPER_ADMIN' } }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import HqHierarchyPage from '@/app/hq/hierarchy/page';

const ASSISTANT = {
  id: 'asv-1',
  fullName: 'Asisten Satu',
  phone: '0801',
  role: 'ASSISTANT_SUPERVISOR',
  status: 'ACTIVE',
};
const SUPERVISOR = {
  id: 'spv-1',
  fullName: 'Spv Satu',
  phone: '0802',
  role: 'SUPERVISOR',
  status: 'ACTIVE',
};

const MANAGER = {
  id: 'mgr-1',
  fullName: 'Manajer Satu',
  phone: '0803',
  role: 'MANAGER',
  status: 'ACTIVE',
};
const COURIER = {
  id: 'kur-1',
  fullName: 'Kurir Satu',
  phone: '0804',
  role: 'STAFF_DEPOT',
  status: 'ACTIVE',
};
const LEADERS = [ASSISTANT, SUPERVISOR, MANAGER];

/**
 * The staff SEARCH answers only what the query matches; the assistant read and the by-ids
 * read answer regardless. That asymmetry is the whole point of C-3 and C-4.
 */
function routeReads(searchResults: unknown[]) {
  get.mockImplementation((path: string) => {
    // The per-role leader reads: answered by role, whatever the search box says.
    const role = /role=([A-Z_]+)/.exec(path)?.[1];
    if (role) {
      const items = LEADERS.filter((p) => p.role === role);
      return Promise.resolve({ items, total: items.length, page: 1, limit: 100 });
    }
    if (path.includes('/auth/staff')) {
      return Promise.resolve({
        items: searchResults,
        total: searchResults.length,
        page: 1,
        limit: 25,
      });
    }
    if (path.includes('customers/by-ids')) return Promise.resolve([ASSISTANT, SUPERVISOR]);
    if (path.includes('staff-hierarchy')) {
      return Promise.resolve({
        superiorId: 'spv-1',
        subordinateIds: [],
        assistantDepotIds: [],
        directDepotIds: [],
      });
    }
    if (path.includes('/depots')) {
      return Promise.resolve({
        items: [{ id: 'dep-1', code: 'JKT-01', name: 'Depot Satu', assistantSupervisorId: null }],
        total: 1,
        page: 1,
        limit: 200,
      });
    }
    return Promise.resolve({ items: [], total: 0, page: 1, limit: 25 });
  });
}

beforeEach(() => {
  get.mockReset();
  put.mockReset().mockResolvedValue(undefined);
  del.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('HqHierarchyPage', () => {
  /*
   * C-3. The depot → assistant picker used to be `people.filter(role === ASSISTANT_...)`
   * over the 25-row NAME SEARCH, so the bottom rung of the whole chain was empty unless you
   * happened to have searched an assistant by name. It reads for itself now.
   */
  it('populates the assistant picker even with an unrelated search active', async () => {
    routeReads([SUPERVISOR]);
    render(<HqHierarchyPage />);

    await waitFor(() => expect(screen.getByText('JKT-01 · Depot Satu')).toBeTruthy());
    // The staff picker lists leaders too now, so look only at the depot's own picker.
    await waitFor(() => {
      const depotPickers = screen.getAllByRole('combobox').filter(
        (el) => el.querySelector('option')?.textContent !== 'hq.hierarchy.pickStaffNone',
      );
      expect(depotPickers.some((el) => el.querySelector('option[value="asv-1"]'))).toBe(true);
    });
  });

  /*
   * C-4. `staffId` survives a query change and the search results do not, so
   * `people.find(p => p.id === staffId)` returned undefined and `grantsDepots('')` was
   * false — the label then claimed "reporting line only" for an ASSISTANT_SUPERVISOR whose
   * link genuinely widens RBAC scope. Defaulting to the reassuring answer is the one thing
   * this label must not do.
   */
  it('keeps the "grants depot access" label right after the search moves on', async () => {
    routeReads([ASSISTANT]);
    render(<HqHierarchyPage />);

    // The depot's assistant picker offers the same account id, so the staff picker is
    // identified by its own placeholder option instead.
    const staffSelect = await waitFor(() => {
      const found = screen.getAllByRole('combobox').find((el) => {
        const first = el.querySelector('option');
        return first?.textContent === 'hq.hierarchy.pickStaffNone';
      });
      if (!found?.querySelector('option[value="asv-1"]')) throw new Error('staff picker not ready');
      return found as HTMLSelectElement;
    });
    await userEvent.selectOptions(staffSelect, 'asv-1');

    await waitFor(() => expect(screen.getByText('hq.hierarchy.linkGrants')).toBeTruthy());

    // Now type something that matches nobody: the selected person leaves `people` entirely.
    routeReads([]);
    await userEvent.type(screen.getByPlaceholderText('hq.hierarchy.searchHint'), 'zzz');

    await waitFor(() => expect(screen.getByText('hq.hierarchy.linkGrants')).toBeTruthy());
  });

  /*
   * The superior picker was the 25-row search minus the selected person. With an empty box
   * that is the 25 newest staff - couriers, after an import - so a supervisor could not be
   * put under any manager. Leaders are read in full and always offered.
   */
  it('offers every manager as a superior even when the search shows only couriers', async () => {
    routeReads([COURIER]);
    render(<HqHierarchyPage />);

    const staffSelect = await waitFor(() => {
      const found = screen.getAllByRole('combobox').find((el) => {
        const first = el.querySelector('option');
        return first?.textContent === 'hq.hierarchy.pickStaffNone';
      });
      if (!found?.querySelector('option[value="spv-1"]')) throw new Error('staff picker not ready');
      return found as HTMLSelectElement;
    });
    await userEvent.selectOptions(staffSelect, 'spv-1');

    // Search for the courier: the manager is no longer anywhere in the search results.
    await userEvent.type(screen.getByPlaceholderText('hq.hierarchy.searchHint'), 'Kurir');

    const superiorSelect = await waitFor(() => {
      const found = screen.getAllByRole('combobox').find((el) => {
        const first = el.querySelector('option');
        return first?.textContent === 'hq.hierarchy.noSuperior';
      });
      if (!found) throw new Error('superior picker not ready');
      return found as HTMLSelectElement;
    });
    expect(superiorSelect.querySelector('option[value="mgr-1"]')).toBeTruthy();
  });
});
