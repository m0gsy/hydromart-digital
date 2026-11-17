// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { getCached } = vi.hoisted(() => ({ getCached: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: { getCached, get: getCached, post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { EmployeeForm } from '@/components/hr/employee-form';
import { EMPTY_EMPLOYEE_FORM } from '@/lib/hr';
import { LocaleProvider } from '@/lib/locale-context';

getCached.mockImplementation(async (path: string) =>
  String(path).includes('departments')
    ? [
        { id: 'g', code: 'FIN', name: 'Keuangan', depotId: null, active: true },
        { id: 'a', code: 'GDG-A', name: 'Gudang A', depotId: 'd1', active: true },
      ]
    : { items: [{ id: 'd1', name: 'Depot Satu' }] },
);

const picker = (firstOption: string) =>
  screen.getAllByRole('combobox').find((el) => el.querySelector('option')?.textContent === firstOption) as HTMLSelectElement;

/*
 * Asisten SPV and up, and head-office staff, have no home depot on purpose. The department
 * used to stay locked until a depot was picked, so none of them could be put in Keuangan or
 * HR without inventing a placement depot that would then fence their attendance.
 */
describe('employee form · department without a depot', () => {
  it('offers the network-wide departments to a person with no depot', async () => {
    render(
      <LocaleProvider>
        <EmployeeForm initial={EMPTY_EMPLOYEE_FORM} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(picker('Belum diatur').querySelector('option[value="g"]')).toBeTruthy());
    const dept = picker('Belum diatur');
    expect(dept.disabled).toBe(false);
    expect(dept.querySelector('option[value="a"]')).toBeNull();
  });

  it("drops a depot's own department when the depot is changed away from it", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <EmployeeForm initial={EMPTY_EMPLOYEE_FORM} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(picker('Pilih depot…').querySelector('option[value="d1"]')).toBeTruthy());
    await user.selectOptions(picker('Pilih depot…'), 'd1');
    await user.selectOptions(picker('Belum diatur'), 'a');
    expect(picker('Belum diatur').value).toBe('a');
    await user.selectOptions(picker('Pilih depot…'), '');
    expect(picker('Belum diatur').value).toBe('');
  });

  it('keeps a network-wide department across a change of depot', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <EmployeeForm initial={EMPTY_EMPLOYEE_FORM} />
      </LocaleProvider>,
    );
    await waitFor(() => expect(picker('Belum diatur').querySelector('option[value="g"]')).toBeTruthy());
    await user.selectOptions(picker('Belum diatur'), 'g');
    await user.selectOptions(picker('Pilih depot…'), 'd1');
    expect(picker('Belum diatur').value).toBe('g');
  });
});
