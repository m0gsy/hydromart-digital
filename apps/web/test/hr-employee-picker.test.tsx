// @vitest-environment jsdom
/**
 * CA-1-17 — the employee picker stops being a 100-row ceiling.
 *
 * It was a `<select>` over `endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 })`,
 * and the comment above that number already said what the right answer was: "100 is the
 * DTO's hard @Max — a depot past 100 active staff needs a search-as-you-type picker, not a
 * bigger page." A bigger page is not reachable (the server caps at 100), so at 101 active
 * staff somebody simply could not be selected — and this picker is how payroll, allowances,
 * attendance corrections and performance reviews are attached to a person.
 *
 * The rules pinned here:
 *   1. the SERVER narrows — `search` reaches the API, which is the parameter that makes the
 *      101st employee reachable at all;
 *   2. one search costs one request, not one per keystroke;
 *   3. typing over a chosen name CLEARS the choice — leaving the old id behind while the
 *      box shows a different word is how a payslip is written for the wrong person.
 *
 * Put `pageSize: 100` and a `<select>` back and every case below fails.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCached } = vi.hoisted(() => ({ getCached: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, getCached } };
});

import { EmployeeSelect } from '@/components/hr/employee-select';
import { LocaleProvider } from '@/lib/locale-context';

const emp = (id: string, employeeCode: string, fullName: string) => ({
  id,
  employeeCode,
  fullName,
  status: 'ACTIVE',
});

function show(onChange = vi.fn(), value = '') {
  render(
    <LocaleProvider>
      <EmployeeSelect value={value} onChange={onChange} />
    </LocaleProvider>,
  );
  return onChange;
}

/** Every URL the component asked for, in order. */
const urls = () => getCached.mock.calls.map((c) => String(c[0]));

describe('EmployeeSelect (CA-1-17)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getCached.mockReset();
    getCached.mockResolvedValue({
      rows: [emp('e-1', 'HM-001', 'Budi Santoso'), emp('e-2', 'HM-002', 'Siti Aminah')],
      total: 2,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('asks the server to narrow, instead of pulling a capped page and filtering nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    show();

    await waitFor(() => expect(getCached).toHaveBeenCalled());
    // The first read is the idle one: no search yet, and a screenful rather than the @Max.
    expect(urls()[0]).toContain('pageSize=20');
    expect(urls()[0]).not.toContain('pageSize=100');

    await user.type(screen.getByRole('combobox'), 'siti');
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(urls().at(-1)).toContain('search=siti'));
  });

  it('spends one request on a search, not one per keystroke', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    show();
    await waitFor(() => expect(getCached).toHaveBeenCalledTimes(1));

    await user.type(screen.getByRole('combobox'), 'budi');
    await vi.advanceTimersByTimeAsync(400);

    // One idle read plus one settled search — four keystrokes, not four requests.
    await waitFor(() => expect(getCached).toHaveBeenCalledTimes(2));
  });

  it('reports a chosen employee by id', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = show();

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByText('Siti Aminah')).toBeTruthy());
    await user.click(screen.getByText('Siti Aminah'));

    expect(onChange).toHaveBeenCalledWith('e-2');
  });

  /*
   * The dangerous one. With a chosen employee and a half-typed different name, the field
   * says one thing and the form holds another — and the form is what writes the payslip.
   */
  it('clears the choice the moment somebody types over it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = show(vi.fn(), 'e-1');

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('s');

    expect(onChange).toHaveBeenCalledWith('');
  });

  // "No match" and "the read failed" are different answers, and a picker that gives the
  // first for the second is how somebody concludes a colleague has left the company.
  it('says the read failed rather than reporting nobody', async () => {
    getCached.mockRejectedValue(new Error('hr-service unreachable'));
    render(
      <LocaleProvider>
        <EmployeeSelect value="" onChange={vi.fn()} />
      </LocaleProvider>,
    );

    // An ErrorState with a retry, not a combobox that quietly finds nobody. The message
    // itself is `ErrorState`'s generic one; what matters is that this is a FAILURE surface
    // and not an empty result.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /coba lagi|try again/i })).toBeTruthy(),
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
