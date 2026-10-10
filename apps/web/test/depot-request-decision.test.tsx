// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const get = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn() },
  ApiError: class ApiError extends Error {
    status = 400;
  },
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd2', name: 'Pekayon' }] }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/hr/depot-picker', () => ({ HrDepotPicker: () => null }));

import { EmployeeDepotAssignment } from '@/components/hr/employee-depot-assignment';
import { LocaleProvider } from '@/lib/locale-context';

const row = {
  id: 'r1',
  employeeId: 'e1',
  kind: 'LOAN',
  depotId: 'd2',
  startDate: '2026-10-20T00:00:00.000Z',
  endDate: '2026-10-25T00:00:00.000Z',
  status: 'REQUESTED',
  failReason: null,
  note: null,
};

function view() {
  render(
    <LocaleProvider>
      <EmployeeDepotAssignment employeeId="e1" />
    </LocaleProvider>,
  );
}

describe('HR decides a manager request on the employee card', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({});
    get.mockReset().mockResolvedValue({ rows: [row], total: 1 });
  });

  it('approve posts straight away', async () => {
    view();
    fireEvent.click(await screen.findByText('Setujui'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]?.[0])).toMatch(/depot-assignments\/r1\/approve$/);
  });

  it('reject asks for a reason in the card, and sends it', async () => {
    view();
    fireEvent.click(await screen.findByText('Tolak'));
    const form = screen.getByRole('textbox', { name: /Alasan penolakan/ }).closest('form') as HTMLFormElement;
    const submit = form.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // no reason yet
    fireEvent.change(screen.getByRole('textbox', { name: /Alasan penolakan/ }), {
      target: { value: 'stok orang kurang' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.submit(form);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, { reason: string }];
    expect(url).toMatch(/depot-assignments\/r1\/reject$/);
    expect(body).toEqual({ reason: 'stok orang kurang' });
  });
});
