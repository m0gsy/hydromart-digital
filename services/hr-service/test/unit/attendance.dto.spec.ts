import 'reflect-metadata';
import { validateSync } from 'class-validator';

import { AdjustAttendanceDto, ManualAttendanceDto } from '../../src/modules/dto/attendance.dto';

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
