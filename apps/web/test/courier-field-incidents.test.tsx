// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-4-48 — the incidents that were written down and read by nobody.
 *
 * A courier's field report is stored by delivery-service, and only HIGH severity is pushed
 * to the ops feed. The domain calls LOW and MEDIUM "logged for later review", but the only
 * other read on that table was the courier's own history — so the later review could be
 * done by exactly one person: whoever wrote the report. A breakdown, a customer dispute, a
 * damaged load: recorded, and invisible to the depot that had to do something about it.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import IncidentsPage from '@/app/dashboard/incidents/page';

const FIELD = [
  {
    id: 'f-1',
    driverId: 'drv-1',
    deliveryId: null,
    category: 'VEHICLE_BREAKDOWN',
    severity: 'MEDIUM',
    description: 'Rantai motor putus di Jl. Kemang',
    photoUrl: null,
    createdAt: '2026-07-01T02:00:00.000Z',
  },
];

function route(raw: unknown) {
  const path = String(raw ?? '');
  if (path.includes('field-incidents')) return Promise.resolve(FIELD);
  if (path.includes('auth/drivers')) {
    return Promise.resolve([{ id: 'drv-1', fullName: 'Budi Santoso', phone: '08', role: 'STAFF_DEPOT' }]);
  }
  return Promise.resolve([]);
}

beforeEach(() => get.mockReset().mockImplementation(route));

describe('CA-4-48 the depot reads its couriers’ field reports', () => {
  it('asks delivery-service for this depot’s reports', async () => {
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Rantai motor putus/)).toBeTruthy());

    const asked = get.mock.calls.map((c) => String(c[0]));
    expect(asked).toContain('/deliveries/api/v1/field-incidents?depotId=d-1');
  });

  it('shows a MEDIUM report — the severity ops was never interrupted for', async () => {
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Rantai motor putus/)).toBeTruthy());
    expect(screen.getByText('dashB.incidents.severity.MEDIUM')).toBeTruthy();
  });

  it('names the courier instead of printing their uuid', async () => {
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Budi Santoso/)).toBeTruthy());
    expect(screen.queryByText(/drv-1/)).toBeNull();
  });

  it('still reads when the roster cannot be fetched — the report is the point', async () => {
    get.mockImplementation((raw: unknown) =>
      String(raw ?? '').includes('drivers')
        ? Promise.reject(new Error('roster down'))
        : route(raw),
    );
    render(<IncidentsPage />);

    await waitFor(() => expect(screen.getByText(/Rantai motor putus/)).toBeTruthy());
    expect(screen.getByText(/dashB\.incidents\.courierUnknown/)).toBeTruthy();
  });
});
