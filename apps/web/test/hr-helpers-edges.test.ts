import { describe, expect, it } from 'vitest';

import { auditChanges, employeeToForm, tenureLabel } from '@/lib/hr';

/**
 * The HR pure helpers, on the branches the console never exercises.
 *
 * All three of these are read by screens that only ever hand them well-formed data, so
 * their guard clauses — a null join date, an audit row whose `before` is absent, an
 * employee with every optional column empty — are the paths nothing had walked. Those are
 * exactly the paths a real record takes: an employee imported from the old system has no
 * NPWP, a HIRED audit row has no `before`, and a record mid-migration has no join date.
 */

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${Object.values(vars).join(',')}` : key;

describe('tenureLabel', () => {
  it('says nothing rather than guessing when there is no join date', () => {
    expect(tenureLabel(null, t)).toBe('—');
    expect(tenureLabel(undefined, t)).toBe('—');
    expect(tenureLabel('', t)).toBe('—');
  });

  it('says nothing for a date it cannot parse, instead of NaN years', () => {
    // An imported row can carry anything in this column.
    expect(tenureLabel('not-a-date', t)).toBe('—');
  });

  it('counts whole years from the join date', () => {
    expect(tenureLabel('2020-01-06', t, new Date('2026-01-06T00:00:00Z'))).toBe(
      'hrFix.common.years:6',
    );
  });

  it('does not credit a year that has not come round yet', () => {
    // One day short of the anniversary is still five years, not six.
    expect(tenureLabel('2020-01-06', t, new Date('2026-01-05T00:00:00Z'))).toBe(
      'hrFix.common.years:5',
    );
    // And one month short, which is the other half of the same guard.
    expect(tenureLabel('2020-06-06', t, new Date('2026-01-06T00:00:00Z'))).toBe(
      'hrFix.common.years:5',
    );
  });

  it('never reports a negative tenure for a future join date', () => {
    expect(tenureLabel('2030-01-06', t, new Date('2026-01-06T00:00:00Z'))).toBe(
      'hrFix.common.years:0',
    );
  });
});

describe('auditChanges', () => {
  const log = (before: unknown, after: unknown) =>
    ({ id: 'a1', before, after }) as unknown as Parameters<typeof auditChanges>[0];

  it('reads a row that has no before — a creation, not a change', () => {
    expect(auditChanges(log(null, { status: 'ACTIVE' }))).toEqual([
      { key: 'status', from: '—', to: 'ACTIVE' },
    ]);
  });

  it('reads a row that has no after — a deletion', () => {
    expect(auditChanges(log({ status: 'ACTIVE' }, null))).toEqual([
      { key: 'status', from: 'ACTIVE', to: '—' },
    ]);
  });

  it('drops keys whose value did not actually move', () => {
    const rows = auditChanges(log({ a: 1, b: 2 }, { a: 1, b: 3 }));
    expect(rows.map((r) => r.key)).toEqual(['b']);
  });

  it('renders an object value rather than printing [object Object]', () => {
    const rows = auditChanges(log({ meta: { x: 1 } }, { meta: { x: 2 } }));
    expect(rows[0]?.from).toBe('{"x":1}');
    expect(rows[0]?.to).toBe('{"x":2}');
  });

  it('treats null and undefined as the same absence, so neither shows as a change', () => {
    expect(auditChanges(log({ a: null }, { a: undefined }))).toEqual([]);
  });
});

describe('employeeToForm', () => {
  const bare = {
    id: 'e1',
    fullName: 'Budi',
    phone: '0811',
    position: 'Kurir',
    employmentStatus: 'PERMANENT',
    joinDate: '2025-01-06T00:00:00.000Z',
    salaryType: 'MONTHLY',
    status: 'ACTIVE',
    email: null,
    depotId: null,
    role: null,
    dailyRate: null,
    monthlyRate: null,
    bankName: null,
    bankAccount: null,
    emergencyName: null,
    gender: null,
    address: null,
    ptkpStatus: null,
    contractEndDate: null,
    exitDate: null,
  } as unknown as Parameters<typeof employeeToForm>[0];

  it('turns every absent column into an empty string, never the word null', () => {
    const form = employeeToForm(bare);
    for (const [key, value] of Object.entries(form)) {
      expect(typeof value, `${key} must be a string for a controlled input`).toBe('string');
      expect(value).not.toBe('null');
      expect(value).not.toBe('undefined');
    }
  });

  it('trims the two date columns to the day an <input type="date"> accepts', () => {
    const form = employeeToForm({
      ...bare,
      contractEndDate: '2026-12-31T00:00:00.000Z',
      exitDate: '2026-08-31T00:00:00.000Z',
    } as unknown as Parameters<typeof employeeToForm>[0]);
    expect(form.joinDate).toBe('2025-01-06');
    expect(form.contractEndDate).toBe('2026-12-31');
    expect(form.exitDate).toBe('2026-08-31');
  });
});
