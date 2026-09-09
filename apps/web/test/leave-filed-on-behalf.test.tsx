// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-1-44 — HR could not file leave for anybody but itself.
 *
 * The only way to apply was `POST /leave`, which resolves the applicant from the session.
 * So an application could only ever come from the person taking the leave — which excludes
 * the two groups who need it most: staff whose employee record has no login at all
 * (`authSubjectId` is nullable), and the courier who phones in sick at 5am. HR took the
 * call and had nowhere to write it down, so the day went in as an ABSENT correction and the
 * leave ledger never saw it.
 */

const { get, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn() },
  // Mirrors the real one's shape: the useful half is `message`, and it is the SECOND
  // argument — a mock that swallows the status would put "409" on screen.
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }),
}));
vi.mock('@/components/hr/employee-select', () => ({
  EmployeeSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      aria-label="employee"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import LeaveQueuePage from '@/app/hr/leave/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ rows: [], total: 0 });
  post.mockReset().mockResolvedValue({ id: 'lv1' });
  toast.mockReset();
});

/** The screen's fields are `<label>` wrappers, so each one is found by the words above it. */
function inputUnder(label: string): HTMLInputElement {
  const field = screen.getByText(label).querySelector('input');
  if (!field) throw new Error(`no input under ${label}`);
  return field;
}

async function openForm() {
  render(<LeaveQueuePage />);
  await waitFor(() => expect(screen.getByText('hrFix.leave.fileForEmployee')).toBeTruthy());
  await userEvent.click(screen.getByRole('button', { name: 'hrFix.leave.fileForEmployee' }));
}

describe('CA-1-44 HR files an application for an employee', () => {
  it('sends the employee, the dates and the reason to the server', async () => {
    await openForm();

    await userEvent.type(screen.getByLabelText('employee'), 'e-9');
    await userEvent.type(inputUnder('hrFix.leave.fileStart'), '2026-07-06');
    await userEvent.type(inputUnder('hrFix.leave.fileEnd'), '2026-07-06');
    await userEvent.type(inputUnder('hrFix.leave.fileReason'), 'Sakit, menelepon pagi');
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.leave.fileSubmit' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/leave/api/v1/leave/on-behalf');
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      employeeId: 'e-9',
      type: 'SICK',
      reason: 'Sakit, menelepon pagi',
    });
  });

  it('refuses to send a half-filled form, and says which half', async () => {
    await openForm();

    await userEvent.click(screen.getByRole('button', { name: 'hrFix.leave.fileSubmit' }));

    expect(post).not.toHaveBeenCalled();
    expect(String(toast.mock.calls[0]?.[0])).toBe('hrFix.leave.fileFillAll');
    expect(toast.mock.calls[0]?.[1]).toBe('error');
  });

  it('repeats the server’s own refusal rather than a generic one', async () => {
    const { ApiError } = await import('@/lib/api');
    // "Sisa kuota cuti 2 hari, pengajuan 5 hari" is the useful sentence; a generic
    // "could not file that" would send HR back to guess which rule it broke.
    post.mockRejectedValue(new ApiError(409, 'Sisa kuota cuti 2 hari', 'CONFLICT'));
    await openForm();

    await userEvent.type(screen.getByLabelText('employee'), 'e-9');
    await userEvent.type(inputUnder('hrFix.leave.fileStart'), '2026-07-06');
    await userEvent.type(inputUnder('hrFix.leave.fileEnd'), '2026-07-10');
    await userEvent.type(inputUnder('hrFix.leave.fileReason'), 'Cuti tahunan');
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.leave.fileSubmit' }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]?.[0])).toBe('Sisa kuota cuti 2 hari');
  });
});
