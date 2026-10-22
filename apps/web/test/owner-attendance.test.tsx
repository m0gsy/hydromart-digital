// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getBlob, toast, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
  toast: vi.fn(),
  role: { current: 'FRANCHISE_OWNER' },
}));

vi.mock('@/lib/api', async () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { api: { get }, getBlob, ApiError };
});
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'o1', role: role.current } }) }));

import { ApiError } from '@/lib/api';
import OwnerAttendancePage from '@/app/dashboard/franchise/attendance/page';
import { loadSessionCapabilities, canViewOwnAttendance } from '@/lib/roles';
import { LocaleProvider } from '@/lib/locale-context';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  employeeId: 'e1',
  depotId: A,
  workDate: '2026-10-20',
  checkInAt: '2026-10-20T01:05:00.000Z',
  checkOutAt: '2026-10-20T10:00:00.000Z',
  checkInScore: 0.91,
  checkOutScore: null,
  lateMinutes: 5,
  workingMinutes: 480,
  status: 'LATE',
  employeeName: 'Budi Santoso',
  ...over,
});

const SUMMARY = {
  from: '2026-10-01',
  to: '2026-10-22',
  depots: [
    { depotId: A, depotName: 'Depot Dago', present: 10, late: 3, absent: 1, leave: 2, holiday: 0, pending: 1, lateMinutes: 55, employees: 6 },
    { depotId: B, depotName: null, present: 0, late: 0, absent: 0, leave: 0, holiday: 0, pending: 0, lateMinutes: 0, employees: 0 },
  ],
};

function route(over: { depots?: unknown; summary?: unknown; list?: unknown } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/owner/depots')) return over.depots ?? [{ id: A, name: 'Depot Dago' }, { id: B, name: null }];
    if (url.includes('/owner/summary')) return over.summary ?? SUMMARY;
    if (url.includes('/attendance/owner')) return over.list ?? { rows: [row()], total: 1, page: 1, pageSize: 50 };
    throw new Error(`unexpected ${url}`);
  });
}

const wrap = () =>
  render(
    <LocaleProvider>
      <OwnerAttendancePage />
    </LocaleProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  role.current = 'FRANCHISE_OWNER';
  loadSessionCapabilities('FRANCHISE_OWNER', ['hrViewOwn']);
  route();
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:frame');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  loadSessionCapabilities(null, null);
});

describe('owner attendance screen', () => {
  it('shows the summary per depot with a network total, and the log', async () => {
    wrap();
    await screen.findByText('Depot Dago', { selector: 'p' });
    // Per-depot figures, the second depot named by its short id because depot-service had no name.
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getByText(B.slice(0, 8), { selector: 'p' })).toBeTruthy();
    await screen.findByText('Budi Santoso');
    expect(screen.getByText('+5m')).toBeTruthy();
    // It asked ONLY the owner routes.
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('/attendance/owner'))).toBe(true);
    expect(get.mock.calls.every((c) => c[1] === true)).toBe(true);
  });

  it('passes the depot, status and range filters through', async () => {
    wrap();
    await screen.findByText('Budi Santoso');
    fireEvent.change(screen.getByLabelText(/Depot|Depot/), { target: { value: B } });
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes(`depotId=${B}`))).toBe(true));
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'ABSENT' } });
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('status=ABSENT'))).toBe(true));
  });

  it('refuses an inverted range without asking the server', async () => {
    wrap();
    await screen.findByText('Budi Santoso');
    get.mockClear();
    fireEvent.change(screen.getByLabelText(/Dari|From/), { target: { value: '2999-01-01' } });
    await screen.findByRole('alert');
    expect(get).not.toHaveBeenCalled();
  });

  it('opens the face frame through the API and shows it inline, then closes it', async () => {
    getBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /Foto masuk|Check-in photo/ }));
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe('blob:frame');
    expect(getBlob).toHaveBeenCalledWith('/attendance/api/v1/attendance/owner/r1/photo/in');
    // Only the side that has a frame is offered.
    expect(screen.queryByRole('button', { name: /Foto pulang|Check-out photo/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tutup foto|Close photo/ }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame');
  });

  it('says so when a frame cannot be opened', async () => {
    getBlob.mockRejectedValue(new Error('gone'));
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /Foto masuk|Check-in photo/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0]?.[1]).toBe('error');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('a row with no face score offers no photo', async () => {
    route({ list: { rows: [row({ checkInScore: null, employeeName: null })], total: 1, page: 1, pageSize: 50 } });
    wrap();
    await screen.findByText(/nama tidak tersedia|name unavailable/);
    expect(screen.queryByRole('button', { name: /Foto|photo/ })).toBeNull();
  });

  it('an owner with no depots sees an explanation, not an empty table', async () => {
    route({ depots: [] });
    wrap();
    await screen.findByText(/Belum ada depot atas nama Anda|No depot under your name yet/);
  });

  it('shows a load failure instead of an empty roster', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/owner/depots')) return [{ id: A, name: 'Depot Dago' }];
      if (url.includes('/owner/summary')) return SUMMARY;
      throw new ApiError(503, '503 down');
    });
    wrap();
    await screen.findByText(/503 down/);
    expect(screen.queryByText(/Tidak ada data absensi|No attendance in this range/)).toBeNull();
  });

  it('shows a depot-list failure and an empty-range message', async () => {
    get.mockRejectedValueOnce(new ApiError(503, 'depots down'));
    wrap();
    await screen.findByText(/depots down/);
    cleanup();
    route({ list: { rows: [], total: 0, page: 1, pageSize: 50 } });
    wrap();
    await screen.findByText(/Tidak ada data absensi|No attendance in this range/);
  });

  it('is closed to anyone who is not an owner', async () => {
    role.current = 'MANAGER';
    loadSessionCapabilities('MANAGER', ['hrView']);
    wrap();
    await screen.findByText(/Tidak ada akses|No access/);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the gate follows the capability', () => {
  it('only an owner (or a super admin) passes', () => {
    loadSessionCapabilities(null, null);
    expect(canViewOwnAttendance('FRANCHISE_OWNER')).toBe(true);
    expect(canViewOwnAttendance('SUPER_ADMIN')).toBe(true);
    for (const r of ['HR', 'HEAD_OFFICE', 'DIREKTUR', 'FINANCE', 'MANAGER', 'KEPALA_DEPOT', 'CUSTOMER']) {
      expect(canViewOwnAttendance(r), r).toBe(false);
    }
  });
});
