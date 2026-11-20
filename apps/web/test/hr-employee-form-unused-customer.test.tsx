// @vitest-environment jsdom
/**
 * Owner decision 2026-11-20: when HR corrects an employee's phone onto a number held by a
 * customer account that was never used, that account is closed only after HR has read whose it
 * is. The first save answers 409 HR_PHONE_UNUSED_CUSTOMER naming the account; the next one
 * confirms. A typo then stays a typo instead of closing a stranger's account.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCached, patch, push } = vi.hoisted(() => ({
  getCached: vi.fn(),
  patch: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, getCached, get: getCached, post: vi.fn(), patch } };
});

import { ApiError } from '@/lib/api';
import { EmployeeForm } from '@/components/hr/employee-form';
import { EMPTY_EMPLOYEE_FORM } from '@/lib/hr';
import { LocaleProvider } from '@/lib/locale-context';

const NAMED =
  'Nomor HP ini dipakai akun pelanggan atas nama Khoirul (dibuat 18 November 2026) yang belum pernah dipakai.';

const FORM = {
  ...EMPTY_EMPLOYEE_FORM,
  fullName: 'Khoirul Huda',
  phone: '082173574322',
  position: 'Kurir',
  joinDate: '2026-11-01',
  depotId: 'd1',
  salaryType: 'MONTHLY' as const,
  monthlyRate: '4500000',
};

beforeEach(() => {
  push.mockReset();
  patch.mockReset();
  getCached.mockImplementation(async (path: string) =>
    String(path).includes('departments') ? [] : { items: [{ id: 'd1', name: 'Depot Satu' }] },
  );
});

function renderEdit() {
  render(
    <LocaleProvider>
      <EmployeeForm initial={FORM} id="emp-1" />
    </LocaleProvider>,
  );
}

describe('employee form · a phone held by a never-used customer account', () => {
  it('names the account, then closes it only on the confirming save', async () => {
    const user = userEvent.setup();
    patch
      .mockRejectedValueOnce(new ApiError(409, NAMED, 'HR_PHONE_UNUSED_CUSTOMER'))
      .mockResolvedValueOnce({});
    renderEdit();

    await user.click(screen.getByRole('button', { name: /simpan perubahan/i }));
    expect((await screen.findByRole('alert')).textContent).toBe(NAMED);
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('confirmCloseCustomer');
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Tutup akun pelanggan itu & simpan' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/hr/employees/detail?id=emp-1'));
    expect(patch.mock.calls[1]![1]).toMatchObject({
      phone: '082173574322',
      confirmCloseCustomer: true,
    });
  });

  it('asks again after the number is corrected — the confirmation was for that number', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(new ApiError(409, NAMED, 'HR_PHONE_UNUSED_CUSTOMER'));
    renderEdit();

    await user.click(screen.getByRole('button', { name: /simpan perubahan/i }));
    await screen.findByRole('alert');
    const phone = screen.getByDisplayValue('082173574322');
    await user.clear(phone);
    await user.type(phone, '082173574399');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /simpan perubahan/i })).toBeTruthy();
  });

  it('shows any other refusal as an error, with no confirmation offered', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValueOnce(
      new ApiError(400, 'Nomor HP ini sudah dipakai akun lain', 'VALIDATION_ERROR'),
    );
    renderEdit();

    await user.click(screen.getByRole('button', { name: /simpan perubahan/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/sudah dipakai akun lain/);
    expect(screen.queryByRole('button', { name: 'Tutup akun pelanggan itu & simpan' })).toBeNull();
  });
});
