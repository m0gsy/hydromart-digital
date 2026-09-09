// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-1-66 — the face check-in nobody could look at.
 *
 * Every face punch stores a selfie and a match score. Neither ever reached a screen: HR
 * approving a pending punch, or correcting a day's attendance, decided on evidence it was
 * never shown. A barely-passing match — the one row genuinely worth a human look — was
 * indistinguishable from a perfect one, and the frame that would settle it sat in a bucket.
 */

const { get, getBlob, downloadBlob, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
  downloadBlob: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  getBlob,
  ApiError: class extends Error {},
}));
vi.mock('@/lib/csv', () => ({ downloadBlob, toCsv: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/attendance',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/hr/employee-select', () => ({
  EmployeeSelect: () => <div />,
}));

import AttendancePage from '@/app/hr/attendance/page';
import { ConfirmProvider } from '@/components/confirm';

// The screen's correction controls live behind this provider; the proof under each row does
// not, but the page cannot mount without it.
const mount = () =>
  render(
    <ConfirmProvider>
      <AttendancePage />
    </ConfirmProvider>,
  );

const ROW = {
  id: 'a1',
  employeeId: 'e1',
  depotId: 'd1',
  workDate: '2026-07-01',
  checkInAt: '2026-07-01T01:00:00.000Z',
  checkOutAt: null,
  checkInScore: 0.81,
  checkOutScore: null,
  lateMinutes: 0,
  workingMinutes: null,
  status: 'PRESENT',
  employeeName: 'Budi Santoso',
};

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('status=PENDING')
        ? { rows: [], total: 0 }
        : path.includes('/adjustments')
          ? []
          : { rows: [ROW], total: 1 },
    ),
  );
  getBlob.mockReset().mockResolvedValue(new Blob(['x']));
  downloadBlob.mockReset();
  toast.mockReset();
});

describe('CA-1-66 the punch shows what it was accepted on', () => {
  it('puts the match score on the row', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    // 0.81 stored, read as a percentage by whoever has to judge it.
    expect(screen.getByText(/hrFix\.attendance\.matchScore:81/)).toBeTruthy();
  });

  it('fetches the frame through the session, not from a bucket URL', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /photoIn/ }));

    await waitFor(() => expect(getBlob).toHaveBeenCalled());
    expect(getBlob.mock.calls[0]?.[0]).toBe('/attendance/api/v1/attendance/a1/photo/in');
    expect(downloadBlob).toHaveBeenCalled();
  });

  it('says so when the frame cannot be read, instead of failing silently', async () => {
    getBlob.mockRejectedValue(new Error('gone'));
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /photoIn/ }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]?.[0])).toContain('hrFix.attendance.photoFailed');
    expect(toast.mock.calls[0]?.[1]).toBe('error');
  });

  it('offers nothing on a row that carries no score at all', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('status=PENDING')
          ? { rows: [], total: 0 }
          : path.includes('/adjustments')
            ? []
            : { rows: [{ ...ROW, checkInScore: null }], total: 1 },
      ),
    );
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /photoIn/ })).toBeNull();
  });
});
