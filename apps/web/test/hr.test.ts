import { describe, expect, it } from 'vitest';

import {
  EMPTY_EMPLOYEE_FORM,
  departmentLabel,
  departmentsForDepot,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  employeeToForm,
  leaveDeductsQuota,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  ASSET_MOVEMENT_LABEL,
  ASSET_STATUS_LABEL,
  ASSET_TYPES,
  ASSET_TYPE_LABEL,
  assetMoveNeedsRecipient,
  assetMovesFrom,
  ANNOUNCEMENT_DIMENSIONS,
  ANNOUNCEMENT_DIMENSION_LABEL,
  ANNOUNCEMENT_LEVELS,
  ANNOUNCEMENT_LEVEL_LABEL,
  announcementReadRate,
  announcementTargetNeedsValue,
  fmtScore,
  WEEKDAY_LABEL,
  rotationShiftForDay,
  fmtFileSize,
  fmtDate,
  fmtTime,
  toEmployeePayload,
  type Department,
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
  supervisorId: null,
  shiftId: null,
  departmentId: null,
  npwp: null,
  bpjsKes: null,
  bpjsTk: null,
  nik: null,
  birthDate: null,
  gender: null,
  address: null,
  ptkpStatus: null,
  contractEndDate: null,
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

  it('slices the personal dates too and keeps the enums as-is', () => {
    const f = employeeToForm(
      employee({
        nik: '3201010101010001',
        birthDate: '1995-04-02T00:00:00.000Z',
        gender: 'FEMALE',
        address: 'Jl. Melati 3',
        ptkpStatus: 'K1',
        contractEndDate: '2027-01-15T00:00:00.000Z',
      }),
    );
    expect(f).toMatchObject({
      nik: '3201010101010001',
      birthDate: '1995-04-02',
      gender: 'FEMALE',
      address: 'Jl. Melati 3',
      ptkpStatus: 'K1',
      contractEndDate: '2027-01-15',
    });
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
    const r = toEmployeePayload(
      validForm({ salaryType: 'MONTHLY', dailyRate: '', monthlyRate: '0' }),
    );
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

  it('sends the personal fields when filled and omits them when blank', () => {
    const r = toEmployeePayload(
      validForm({
        nik: '3201 0101 0101 0001',
        birthDate: '1995-04-02',
        gender: 'FEMALE',
        address: ' Jl. Melati 3 ',
        ptkpStatus: 'K1',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Spaces are how a KTP is printed; the payload carries the 16 digits.
    expect(r.value.nik).toBe('3201010101010001');
    expect(r.value.birthDate).toBe(new Date('1995-04-02').toISOString());
    expect(r.value.gender).toBe('FEMALE');
    expect(r.value.address).toBe('Jl. Melati 3');
    expect(r.value.ptkpStatus).toBe('K1');

    // Blank cells are omitted, not sent as empty strings the enum would reject.
    const blank = toEmployeePayload(validForm());
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    for (const key of ['nik', 'birthDate', 'gender', 'address', 'ptkpStatus', 'contractEndDate']) {
      expect(blank.value).not.toHaveProperty(key);
    }
  });

  it('rejects a NIK that is not 16 digits', () => {
    const r = toEmployeePayload(validForm({ nik: '320101010101' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('16 digit');
  });

  it('rejects a contract that ends before the join date', () => {
    const r = toEmployeePayload(validForm({ joinDate: '2026-01-15', contractEndDate: '2025-12-31' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Akhir kontrak');
  });

  it('accepts a contract end date on or after the join date', () => {
    const r = toEmployeePayload(validForm({ joinDate: '2026-01-15', contractEndDate: '2027-01-15' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.contractEndDate).toBe(new Date('2027-01-15').toISOString());
  });
});

describe('departments (A1)', () => {
  const dept = (over: Partial<Department>): Department => ({
    id: 'x',
    code: 'X',
    name: 'X',
    depotId: null,
    active: true,
    ...over,
  });
  const rows = [
    dept({ id: 'g', code: 'FIN', name: 'Keuangan' }),
    dept({ id: 'a', code: 'GDG-A', name: 'Gudang A', depotId: 'd1' }),
    dept({ id: 'b', code: 'GDG-B', name: 'Gudang B', depotId: 'd2' }),
    dept({ id: 'off', code: 'OLD', name: 'Lama', active: false }),
  ];

  it('offers a depot its own units plus the network-wide ones, minus the inactive', () => {
    expect(departmentsForDepot(rows, 'd1').map((d) => d.id)).toEqual(['g', 'a']);
    expect(departmentsForDepot(rows, 'd2').map((d) => d.id)).toEqual(['g', 'b']);
  });

  it('labels an unassigned or unknown department as "Belum diatur"', () => {
    expect(departmentLabel(rows, null)).toBe('Belum diatur');
    expect(departmentLabel(rows, 'ghost')).toBe('Belum diatur');
    expect(departmentLabel(rows, 'a')).toBe('GDG-A · Gudang A');
  });

  it('carries departmentId through the form round-trip', () => {
    expect(employeeToForm(employee({ departmentId: 'a' })).departmentId).toBe('a');
    expect(employeeToForm(employee()).departmentId).toBe('');
    const payload = toEmployeePayload({ ...validForm(), departmentId: ' a ' });
    expect(payload.ok && payload.value.departmentId).toBe('a');
    const none = toEmployeePayload(validForm());
    expect(none.ok && 'departmentId' in none.value).toBe(false);
  });
});

describe('leave (B1)', () => {
  it('mirrors the server rule on which types cost quota', () => {
    expect(leaveDeductsQuota('ANNUAL')).toBe(true);
    expect(leaveDeductsQuota('PERMISSION')).toBe(true);
    expect(leaveDeductsQuota('SICK')).toBe(false);
    expect(leaveDeductsQuota('EMERGENCY')).toBe(false);
  });

  it('labels every status and type the API can return', () => {
    for (const t of LEAVE_TYPES) expect(LEAVE_TYPE_LABEL[t]).toBeTruthy();
    for (const s of Object.keys(LEAVE_STATUS_LABEL)) {
      expect(LEAVE_STATUS_LABEL[s as keyof typeof LEAVE_STATUS_LABEL]).toBeTruthy();
    }
  });
});

describe('employee documents (B2)', () => {
  it('formats bytes the way an HR admin reads them', () => {
    expect(fmtFileSize(512)).toBe('512 B');
    expect(fmtFileSize(2048)).toBe('2 KB');
    expect(fmtFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('labels every document type the API can return', () => {
    for (const t of DOCUMENT_TYPES) expect(DOCUMENT_TYPE_LABEL[t]).toBeTruthy();
  });
});

describe('assets (B3)', () => {
  it('offers only the moves the server would accept', () => {
    // Mirrors ASSET_TRANSITIONS in hr-service/src/domain/asset.ts.
    expect(assetMovesFrom('AVAILABLE')).toEqual(['ASSIGN', 'MAINTENANCE', 'LOST']);
    expect(assetMovesFrom('RETURNED')).toEqual(['ASSIGN', 'MAINTENANCE', 'LOST']);
    expect(assetMovesFrom('ASSIGNED')).toEqual(['TRANSFER', 'RETURN', 'MAINTENANCE', 'LOST']);
    expect(assetMovesFrom('MAINTENANCE')).toEqual(['RETURN', 'LOST']);
    // Written off: nothing to offer. Finding it back is a new asset row.
    expect(assetMovesFrom('LOST')).toEqual([]);
    // An asset in hand is never offered a second ASSIGN — TRANSFER is the only way across.
    expect(assetMovesFrom('ASSIGNED')).not.toContain('ASSIGN');
  });

  it('asks for a recipient exactly when the item ends up with a person', () => {
    expect(assetMoveNeedsRecipient('ASSIGN')).toBe(true);
    expect(assetMoveNeedsRecipient('TRANSFER')).toBe(true);
    expect(assetMoveNeedsRecipient('RETURN')).toBe(false);
    expect(assetMoveNeedsRecipient('MAINTENANCE')).toBe(false);
    expect(assetMoveNeedsRecipient('LOST')).toBe(false);
  });

  it('labels every asset type, status and movement the API can return', () => {
    for (const t of ASSET_TYPES) expect(ASSET_TYPE_LABEL[t]).toBeTruthy();
    for (const s of Object.keys(ASSET_STATUS_LABEL)) {
      expect(ASSET_STATUS_LABEL[s as keyof typeof ASSET_STATUS_LABEL]).toBeTruthy();
    }
    for (const k of Object.keys(ASSET_MOVEMENT_LABEL)) {
      expect(ASSET_MOVEMENT_LABEL[k as keyof typeof ASSET_MOVEMENT_LABEL]).toBeTruthy();
    }
  });
});

describe('announcements (C1)', () => {
  it('asks for a value on every target except "everyone"', () => {
    expect(announcementTargetNeedsValue('COMPANY')).toBe(false);
    for (const d of ANNOUNCEMENT_DIMENSIONS.filter((x) => x !== 'COMPANY')) {
      expect(announcementTargetNeedsValue(d)).toBe(true);
    }
  });

  it('states the read rate, and says "—" rather than dividing by zero', () => {
    expect(announcementReadRate(12, 40)).toBe('12 dari 40 dibaca (30%)');
    expect(announcementReadRate(0, 0)).toBe('—');
    expect(announcementReadRate(3, 3)).toBe('3 dari 3 dibaca (100%)');
  });

  it('labels every level and dimension the API can return', () => {
    for (const l of ANNOUNCEMENT_LEVELS) expect(ANNOUNCEMENT_LEVEL_LABEL[l]).toBeTruthy();
    for (const d of ANNOUNCEMENT_DIMENSIONS) expect(ANNOUNCEMENT_DIMENSION_LABEL[d]).toBeTruthy();
  });
});

describe('shift rotation (C3)', () => {
  it('reads a weekday out of the pattern, 0 = Sunday', () => {
    const pattern = { '1': 'pagi', '2': 'malam' };
    expect(rotationShiftForDay(pattern, 1)).toBe('pagi');
    expect(rotationShiftForDay(pattern, 2)).toBe('malam');
  });

  it('a missing or null weekday is a day off, not a guess', () => {
    expect(rotationShiftForDay({ '1': 'pagi' }, 3)).toBeNull();
    expect(rotationShiftForDay({ '3': null }, 3)).toBeNull();
  });

  it('labels all seven days Sunday-first, matching the server keys', () => {
    expect(WEEKDAY_LABEL).toHaveLength(7);
    expect(WEEKDAY_LABEL[0]).toBe('Minggu');
    expect(WEEKDAY_LABEL[6]).toBe('Sabtu');
  });
});

describe('performance score (C2)', () => {
  it('shows an unmeasurable component as "—", never as zero', () => {
    expect(fmtScore(null)).toBe('—');
    expect(fmtScore(0)).toBe('0,0');
    expect(fmtScore(82.456)).toBe('82,5');
    expect(fmtScore(100)).toBe('100,0');
  });
});
