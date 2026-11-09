// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, toast } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch },
  ApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }) }));
vi.mock('@/components/hr/employee-select', () => ({ EmployeeSelect: () => null }));

import LeaveQueuePage from '@/app/hr/leave/page';
import { endpoints } from '@/lib/endpoints';

const row = (status: string) => ({
  id: 'lv1',
  employeeId: 'e1',
  employeeName: 'Budi',
  type: 'ANNUAL',
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2026-12-03T00:00:00.000Z',
  workingDays: 3,
  reason: 'Acara',
  status,
  decisionNote: null,
});

beforeEach(() => {
  patch.mockReset().mockResolvedValue({});
  toast.mockReset();
  get.mockReset().mockResolvedValue({ rows: [row('APPROVED')], total: 1 });
});

describe('/hr/leave · revoking an approved leave (HR-17)', () => {
  it('needs a reason before it sends anything', async () => {
    const user = userEvent.setup();
    render(<LeaveQueuePage />);
    await user.click(await screen.findByText('hrFix.leave.revoke'));
    expect(patch).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('hrFix.leave.revokeNeedsReason', 'error');
  });

  it('sends the reason to the revoke endpoint and reloads the queue', async () => {
    const user = userEvent.setup();
    render(<LeaveQueuePage />);
    await user.type(await screen.findByPlaceholderText('hrFix.leave.revokeHint'), 'operasional');
    await user.click(screen.getByText('hrFix.leave.revoke'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(endpoints.hr.leaveRevoke('lv1'), { reason: 'operasional' }, true));
    expect(toast).toHaveBeenCalledWith('hrFix.leave.revoked');
  });

  it('offers no revoke on a request that is not approved', async () => {
    get.mockResolvedValue({ rows: [row('PENDING_HR')], total: 1 });
    render(<LeaveQueuePage />);
    await screen.findByText('Budi');
    expect(screen.queryByText('hrFix.leave.revoke')).toBeNull();
  });

  it('surfaces the server refusal', async () => {
    patch.mockRejectedValue(new Error('Semua hari cuti ini sudah lewat'));
    const user = userEvent.setup();
    render(<LeaveQueuePage />);
    await user.type(await screen.findByPlaceholderText('hrFix.leave.revokeHint'), 'operasional');
    await user.click(screen.getByText('hrFix.leave.revoke'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('hrFix.leave.failed', 'error'));
  });
});
