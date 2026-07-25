import { describe, expect, it } from 'vitest';

import {
  EMPTY_EMPLOYEE_FORM,
  employeeToForm,
  fmtDate,
  fmtTime,
  toEmployeePayload,
  type Employee,
  type EmployeeForm,
} from '@/lib/hr';

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1',
  employeeCode: 'EMP-001',
  authSubjectId: null,
  fullName: 'Budi Santoso',
  photoUrl: null,
  phone: '0812',
  email: null,
  depotId: 'd1',
  position: 'Kurir',
  employmentStatus: 'PROBATION',
  joinDate: '2026-01-15T00:00:00.000Z',
  salaryType: 'DAILY',
  dailyRate: '150000',
  monthlyRate: null,
  bankName: null,
  bankAccount: null,
  emergencyName: null,
  emergencyPhone: null,
  status: 'ACTIVE',
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
  ...over,
});

const validForm = (over: Partial<EmployeeForm> = {}): EmployeeForm => ({
  ...EMPTY_EMPLOYEE_FORM,
  fullName: 'Budi',
  phone: '0812',
  depotId: 'd1',
  position: 'Kurir',
  joinDate: '2026-01-15',
  salaryType: 'DAILY',
  dailyRate: '150000',
  ...over,
});

describe('fmtDate', () => {
  it('returns em dash for empty/invalid input', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
    expect(fmtDate('not-a-date')).toBe('—');
  });
  it('formats a valid ISO date', () => {
    // id-ID locale, day-2digit month-short year-numeric
    expect(fmtDate('2026-07-01')).toMatch(/2026/);
  });
});

describe('fmtTime', () => {
  it('returns em dash for empty/invalid input', () => {
    expect(fmtTime(null)).toBe('—');
    expect(fmtTime('nope')).toBe('—');
  });
  it('formats a valid ISO datetime', () => {
    expect(fmtTime('2026-07-01T13:05:00.000Z')).toMatch(/\d{2}[.:]\d{2}/);
  });
});

describe('employeeToForm', () => {
  it('coerces nulls to empty strings and slices joinDate to yyyy-mm-dd', () => {
    const f = employeeToForm(employee());
    expect(f.email).toBe('');
    expect(f.monthlyRate).toBe('');
    expect(f.bankName).toBe('');
    expect(f.joinDate).toBe('2026-01-15');
    expect(f.dailyRate).toBe('150000');
  });
});

describe('toEmployeePayload', () => {
  it('rejects when a required field is blank', () => {
    const r = toEmployeePayload(validForm({ fullName: '  ' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fullName');
  });

  it('rejects DAILY salary without a positive dailyRate', () => {
    expect(toEmployeePayload(validForm({ salaryType: 'DAILY', dailyRate: '0' })).ok).toBe(false);
    expect(toEmployeePayload(validForm({ salaryType: 'DAILY', dailyRate: '' })).ok).toBe(false);
  });

  it('rejects MONTHLY salary without a positive monthlyRate', () => {
    const r = toEmployeePayload(validForm({ salaryType: 'MONTHLY', dailyRate: '', monthlyRate: '0' }));
    expect(r.ok).toBe(false);
  });

  it('builds a DAILY payload with numeric dailyRate and ISO joinDate, omitting blanks', () => {
    const r = toEmployeePayload(validForm());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dailyRate).toBe(150000);
    expect(r.value).not.toHaveProperty('monthlyRate');
    expect(r.value).not.toHaveProperty('email');
    expect(r.value.joinDate).toBe(new Date('2026-01-15').toISOString());
  });

  it('builds a MONTHLY payload and includes optional fields when present', () => {
    const r = toEmployeePayload(
      validForm({
        salaryType: 'MONTHLY',
        dailyRate: '',
        monthlyRate: '4500000',
        email: ' a@b.co ',
        bankName: ' BCA ',
        bankAccount: ' 123 ',
        emergencyName: ' Siti ',
        emergencyPhone: ' 0899 ',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.monthlyRate).toBe(4500000);
    expect(r.value).not.toHaveProperty('dailyRate');
    expect(r.value.email).toBe('a@b.co');
    expect(r.value.bankName).toBe('BCA');
    expect(r.value.bankAccount).toBe('123');
    expect(r.value.emergencyName).toBe('Siti');
    expect(r.value.emergencyPhone).toBe('0899');
  });
});
