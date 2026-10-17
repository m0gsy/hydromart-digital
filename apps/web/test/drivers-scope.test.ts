import { describe, expect, it, vi } from 'vitest';

import { driversUrl, whenRosterScoped } from '@/lib/drivers-scope';
import { endpoints } from '@/lib/endpoints';

// auth-service answers GET /auth/drivers with 403 for a MANAGER who covers several depots and
// names none ("sebutkan depotId"), so every dispatch screen that asked without one broke for them.
describe('driversUrl — which roster URL a console screen asks for', () => {
  it('asks for the selected depot whenever one is selected, for any role', () => {
    expect(driversUrl({ selectedId: 'd-1', scopedId: 'd-1', role: 'MANAGER' })).toBe(
      endpoints.auth.driversAt('d-1'),
    );
    expect(driversUrl({ selectedId: 'd-2', scopedId: 'd-1', role: 'SUPER_ADMIN' })).toBe(
      endpoints.auth.driversAt('d-2'),
    );
  });

  it('names a concrete depot for a MANAGER even when "all depots" is selected', () => {
    expect(driversUrl({ selectedId: null, scopedId: 'd-9', role: 'MANAGER' })).toBe(
      endpoints.auth.driversAt('d-9'),
    );
  });

  it('keeps the network-wide roster for head-office roles on "all depots"', () => {
    expect(driversUrl({ selectedId: null, scopedId: 'd-9', role: 'SUPER_ADMIN' })).toBe(
      endpoints.auth.drivers,
    );
    expect(driversUrl({ selectedId: null, scopedId: 'd-9', role: 'HEAD_OFFICE' })).toBe(
      endpoints.auth.drivers,
    );
  });

  it('holds the read back until the depot view is known, instead of asking without one', async () => {
    const load = vi.fn(async (u: string) => [u]);
    const pending = whenRosterScoped(null, load);
    const settled = vi.fn();
    void pending.then(settled);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    await expect(whenRosterScoped('/x', load)).resolves.toEqual(['/x']);
  });

  it('falls back to the plain roster when a manager has no depot in scope yet', () => {
    expect(driversUrl({ selectedId: null, scopedId: null, role: 'MANAGER' })).toBe(
      endpoints.auth.drivers,
    );
  });
});
