import 'reflect-metadata';
import { validateSync } from 'class-validator';

import {
  AdjustAttendanceDto,
  DecideAttendanceDto,
  FacePunchDto,
  ListAttendanceDto,
  ManualAttendanceDto,
} from '../../src/modules/dto/attendance.dto';

const EMPLOYEE = '00000000-0000-4000-8000-000000000001';

function failedProps<T extends object>(Ctor: new () => T, patch: Partial<T>): string[] {
  return validateSync(Object.assign(new Ctor(), patch)).map((e) => e.property);
}

// Both writes land in the HR audit trail. `@IsString()` alone accepts '', which produces
// an audit entry whose justification is blank — indistinguishable from none at all.
describe('attendance reason is mandatory text', () => {
  it('rejects an empty reason on an adjustment', () => {
    expect(
      failedProps(AdjustAttendanceDto, { reason: '', checkInAt: '2026-07-27T01:00:00.000Z' }),
    ).toContain('reason');
  });

  it('rejects an empty reason on a manual entry', () => {
    expect(
      failedProps(ManualAttendanceDto, {
        employeeId: EMPLOYEE,
        workDate: '2026-07-27',
        status: 'PRESENT',
        reason: '',
      }),
    ).toContain('reason');
  });

  it('accepts real text', () => {
    expect(failedProps(AdjustAttendanceDto, { reason: 'Lupa absen, dikoreksi HR' })).not.toContain(
      'reason',
    );
    expect(
      failedProps(ManualAttendanceDto, {
        employeeId: EMPLOYEE,
        workDate: '2026-07-27',
        status: 'PRESENT',
        reason: 'Lupa absen, dicatat manual',
      }),
    ).toEqual([]);
  });
});

// PENDING is produced by the offline path only; HR must not be able to set it by hand.
describe('offline punch DTOs', () => {
  const punch = { image: 'x', lat: -6.2, lng: 106.8 };

  it('accepts an ISO capturedAt and rejects garbage', () => {
    expect(failedProps(FacePunchDto, { ...punch, capturedAt: '2026-07-24T01:10:00.000Z' })).toEqual(
      [],
    );
    expect(failedProps(FacePunchDto, { ...punch, capturedAt: 'kemarin' })).toContain('capturedAt');
  });

  it('treats capturedAt as optional so live punches are unchanged', () => {
    expect(failedProps(FacePunchDto, punch)).toEqual([]);
  });

  it('rejects PENDING on manual entry and adjustment', () => {
    expect(
      failedProps(ManualAttendanceDto, {
        employeeId: EMPLOYEE,
        workDate: '2026-07-27',
        status: 'PENDING' as never,
        reason: 'coba',
      }),
    ).toContain('status');
    expect(
      failedProps(AdjustAttendanceDto, { status: 'PENDING' as never, reason: 'coba' }),
    ).toContain('status');
  });

  it('allows PENDING as a list filter', () => {
    expect(failedProps(ListAttendanceDto, { status: 'PENDING' })).toEqual([]);
    expect(failedProps(ListAttendanceDto, { status: 'ENTAH' })).toContain('status');
  });

  it('constrains the HR decision', () => {
    expect(failedProps(DecideAttendanceDto, { decision: 'APPROVE' })).toEqual([]);
    expect(failedProps(DecideAttendanceDto, { decision: 'MAYBE' as never })).toContain('decision');
    expect(failedProps(DecideAttendanceDto, { decision: 'REJECT', note: 'x'.repeat(201) })).toContain(
      'note',
    );
  });
});
