// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HD-15: equipment is due by days OR by water volume, whichever comes first. The list shows
 * both limits, where the item stands against each, and which one made it due; the form takes
 * either limit or both.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, post, patch: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'KEPALA_DEPOT' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', name: 'Cikini' }],
    selected: { id: 'd-1', name: 'Cikini' },
    scopedId: 'd-1',
    ready: true,
  }),
}));

import MaintenancePage from '@/app/dashboard/maintenance/page';

const base = {
  depotId: 'd-1',
  category: 'RO',
  lastServicedAt: '2026-10-13T08:00:00.000Z',
  note: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-13T08:00:00.000Z',
};
const ITEMS = [
  {
    ...base,
    id: 'm-1',
    name: 'Membran RO',
    intervalDays: null,
    intervalM3: 500,
    nextDueAt: null,
    status: 'DUE',
    daysSinceService: 43,
    m3SinceService: 520.25,
    meterDaysMissing: 3,
    dueBy: 'VOLUME',
  },
  {
    ...base,
    id: 'm-2',
    name: 'Lampu UV',
    intervalDays: 90,
    intervalM3: 800,
    nextDueAt: '2027-01-11T08:00:00.000Z',
    status: 'HEALTHY',
    daysSinceService: 43,
    m3SinceService: null,
    meterDaysMissing: null,
    dueBy: null,
  },
  {
    ...base,
    id: 'm-3',
    name: 'Filter pasir',
    intervalDays: 30,
    intervalM3: null,
    nextDueAt: '2026-11-12T08:00:00.000Z',
    status: 'DUE',
    daysSinceService: 43,
    m3SinceService: null,
    meterDaysMissing: null,
    dueBy: 'DAYS',
  },
];

beforeEach(() => {
  get.mockReset().mockResolvedValue(ITEMS);
  post.mockReset().mockResolvedValue({});
});

describe('HD-15 maintenance by days or volume', () => {
  it('shows each limit, where the item stands and why it is due', async () => {
    render(<MaintenancePage />);
    await waitFor(() => expect(screen.getByText('Membran RO')).toBeTruthy());
    // Volume-only: its limit, the m3 so far (one decimal), the missing meter days, and why it is due.
    expect(screen.getByText(/dashB\.maintenance\.everyM3:500/)).toBeTruthy();
    expect(screen.getByText(/dashB\.maintenance\.m3Since:520,3/)).toBeTruthy();
    expect(screen.getByText(/dashB\.maintenance\.meterMissing:3/)).toBeTruthy();
    expect(screen.getByText('dashB.maintenance.dueByVolume')).toBeTruthy();
    // Days-only: nothing about volume; due because of days.
    expect(screen.getByText('dashB.maintenance.dueByDays')).toBeTruthy();
    // Both limits, meter unreadable: said so, never shown as 0 m3.
    expect(screen.getByText(/dashB\.maintenance\.m3Unknown/)).toBeTruthy();
  });

  it('creates an item with a volume limit alone, and refuses one with no limit at all', async () => {
    const user = userEvent.setup();
    render(<MaintenancePage />);
    await waitFor(() => expect(screen.getByText('Membran RO')).toBeTruthy());
    await user.click(screen.getByText('dashB.maintenance.schedule'));
    await user.type(document.getElementById('m-name') as HTMLInputElement, 'Membran baru');
    await user.type(document.getElementById('m-cat') as HTMLInputElement, 'RO');
    await user.click(screen.getByText('dashB.maintenance.saveSchedule'));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('dashB.maintenance.requiredError');

    await user.type(document.getElementById('m-m3') as HTMLInputElement, '500');
    await user.click(screen.getByText('dashB.maintenance.saveSchedule'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toEqual({ depotId: 'd-1', name: 'Membran baru', category: 'RO', intervalM3: 500 });
  });

  it('sends days with the date when both are given', async () => {
    const user = userEvent.setup();
    render(<MaintenancePage />);
    await waitFor(() => expect(screen.getByText('Membran RO')).toBeTruthy());
    await user.click(screen.getByText('dashB.maintenance.schedule'));
    await user.type(document.getElementById('m-name') as HTMLInputElement, 'Lampu');
    await user.type(document.getElementById('m-cat') as HTMLInputElement, 'UV');
    await user.type(document.getElementById('m-int') as HTMLInputElement, '90');
    await user.type(document.getElementById('m-m3') as HTMLInputElement, '800');
    await user.click(screen.getByText('dashB.maintenance.saveSchedule'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ intervalDays: 90, intervalM3: 800 });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('nextDueAt');
  });
});
