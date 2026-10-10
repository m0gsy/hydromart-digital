// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HR card that lends an employee to another depot. The sweep does the moving; this is
 * where a person says who, where and which days - and where they find out why a plan was
 * refused (all the reasons at once, not one per attempt).
 */

const h = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), toast: vi.fn(), ApiError };
});

vi.mock('@/lib/api', () => ({
  api: { get: h.get, post: h.post, patch: h.patch, getCached: h.get, put: vi.fn(), del: vi.fn() },
  ApiError: h.ApiError,
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'dep-g', name: 'Galaksi', code: 'GLK' },
      { id: 'dep-p', name: 'Pekayon', code: 'PKY' },
    ],
    scopedId: 'dep-g',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { EmployeeDepotAssignment } from '@/components/hr/employee-depot-assignment';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'as-1',
  employeeId: 'e1',
  kind: 'LOAN',
  depotId: 'dep-p',
  startDate: '2026-10-16T00:00:00.000Z',
  endDate: '2026-10-25T00:00:00.000Z',
  status: 'PLANNED',
  failReason: null,
  note: null,
  ...over,
});

beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ rows: [], total: 0 });
  h.post.mockReset().mockResolvedValue({});
  h.patch.mockReset().mockResolvedValue({});
  h.toast.mockReset();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T01:00:00.000Z') });
});
afterEach(() => vi.useRealTimers());

describe('EmployeeDepotAssignment', () => {
  it('is simply not there while the feature is off (404) or not allowed (403)', async () => {
    for (const status of [404, 403]) {
      h.get.mockReset().mockRejectedValue(new h.ApiError(status, 'nope'));
      const { container, unmount } = render(<EmployeeDepotAssignment employeeId="e1" />);
      await waitFor(() => expect(h.get).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      unmount();
    }
  });

  it('shows another failure as a retry, not as silence', async () => {
    h.get.mockRejectedValue(new h.ApiError(500, 'boom'));
    render(<EmployeeDepotAssignment employeeId="e1" />);
    expect(await screen.findByRole('button', { name: /.+/ })).toBeInTheDocument();
    expect(screen.getByText('hrFix.depotAssignment.title')).toBeInTheDocument();
  });

  it('lists assignments with the depot named, the days and the state', async () => {
    h.get.mockResolvedValue({ rows: [row({ status: 'DONE' })], total: 1 });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    expect(await screen.findByText('Pekayon')).toBeInTheDocument();
    expect(screen.getByText('hrFix.depotAssignment.status.DONE')).toBeInTheDocument();
    expect(screen.getAllByText('hrFix.depotAssignment.kind.LOAN').length).toBeGreaterThan(0);
    expect(h.get).toHaveBeenCalledWith('/depot-assignments/api/v1/depot-assignments?employeeId=e1', true);
  });

  it('says there is nothing yet when there is nothing', async () => {
    render(<EmployeeDepotAssignment employeeId="e1" />);
    expect(await screen.findByText('hrFix.depotAssignment.empty')).toBeInTheDocument();
  });

  it('offers "apply now" only for a planned row whose day has come, and cancel for planned', async () => {
    h.get.mockResolvedValue({
      rows: [
        row({ id: 'due', startDate: '2026-10-20T00:00:00.000Z' }),
        row({ id: 'later', startDate: '2026-11-20T00:00:00.000Z', endDate: '2026-11-25T00:00:00.000Z' }),
      ],
      total: 2,
    });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findAllByText('Pekayon');
    expect(screen.getAllByText('hrFix.depotAssignment.applyNow')).toHaveLength(1);
    expect(screen.getAllByText('hrFix.depotAssignment.cancel')).toHaveLength(2);
  });

  it('a running loan can be cut short; a running permanent move cannot be cancelled', async () => {
    h.get.mockResolvedValue({
      rows: [row({ id: 'run', status: 'ACTIVE' }), row({ id: 'perm', kind: 'PERMANENT', status: 'ACTIVE', endDate: null })],
      total: 2,
    });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findAllByText('Pekayon');
    expect(screen.getAllByText('hrFix.depotAssignment.cutShort')).toHaveLength(1);
  });

  it('a failed assignment says why', async () => {
    h.get.mockResolvedValue({ rows: [row({ status: 'FAILED', failReason: 'auth down' })], total: 1 });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('auth down');
  });

  it('cancel and apply-now call the right routes, then reload', async () => {
    h.get.mockResolvedValue({ rows: [row({ startDate: '2026-10-20T00:00:00.000Z' })], total: 1 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await user.click(await screen.findByText('hrFix.depotAssignment.applyNow'));
    expect(h.post).toHaveBeenCalledWith('/depot-assignments/api/v1/depot-assignments/as-1/apply-now', {}, true);
    await user.click(screen.getByText('hrFix.depotAssignment.cancel'));
    expect(h.patch).toHaveBeenCalledWith('/depot-assignments/api/v1/depot-assignments/as-1/cancel', {}, true);
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('a refused cancel is shown as an error, not as success', async () => {
    h.get.mockResolvedValue({ rows: [row()], total: 1 });
    h.patch.mockRejectedValue(new h.ApiError(409, 'sudah berjalan'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await user.click(await screen.findByText('hrFix.depotAssignment.cancel'));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('sudah berjalan', 'error'));
  });

  it('plans a loan with the chosen depot and dates', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findByText('hrFix.depotAssignment.empty');
    await user.selectOptions(screen.getByLabelText('hrFix.depotPicker.aria'), 'dep-p');
    const dates = document.querySelectorAll('input[type="date"]');
    await user.clear(dates[0] as HTMLInputElement);
    await user.type(dates[0] as HTMLInputElement, '2026-10-30');
    await user.type(dates[1] as HTMLInputElement, '2026-11-05');
    await user.click(screen.getByText('hrFix.depotAssignment.plan'));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![0]).toBe('/depot-assignments/api/v1/depot-assignments');
    expect(h.post.mock.calls[0]![1]).toMatchObject({
      employeeId: 'e1',
      kind: 'LOAN',
      depotId: 'dep-p',
      startDate: '2026-10-30',
      endDate: '2026-11-05',
    });
    expect(h.toast).toHaveBeenCalledWith('hrFix.depotAssignment.planned');
  });

  it('a permanent move sends no end date', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findByText('hrFix.depotAssignment.empty');
    await user.selectOptions(screen.getByLabelText('hrFix.depotAssignment.kindLabel'), 'PERMANENT');
    await user.selectOptions(screen.getByLabelText('hrFix.depotPicker.aria'), 'dep-p');
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    await user.click(screen.getByText('hrFix.depotAssignment.plan'));
    await waitFor(() => expect(h.post).toHaveBeenCalled());
    expect(h.post.mock.calls[0]![1]).toMatchObject({ kind: 'PERMANENT', endDate: undefined });
  });

  it('asks for a destination before sending anything', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findByText('hrFix.depotAssignment.empty');
    await user.click(screen.getByText('hrFix.depotAssignment.plan'));
    expect(await screen.findByRole('alert')).toHaveTextContent('hrFix.depotAssignment.pickDepot');
    expect(h.post).not.toHaveBeenCalled();
  });

  it('shows every reason the server gave, one per line', async () => {
    h.post.mockRejectedValue(new h.ApiError(400, 'Jabatan tidak bisa, Tanggal terlalu jauh'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EmployeeDepotAssignment employeeId="e1" />);
    await screen.findByText('hrFix.depotAssignment.empty');
    await user.selectOptions(screen.getByLabelText('hrFix.depotPicker.aria'), 'dep-p');
    await user.click(screen.getByText('hrFix.depotAssignment.plan'));
    const alert = await screen.findByRole('alert');
    expect(alert.querySelectorAll('li')).toHaveLength(2);
  });
});
