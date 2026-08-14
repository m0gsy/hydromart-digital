import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ImportAllowancesDto, ImportAllowanceRowDto } from '../../src/modules/dto/allowance.dto';
import {
  AnnouncementTargetDto,
  CreateAnnouncementDto,
  ListAnnouncementDto,
} from '../../src/modules/dto/announcement.dto';
import {
  CreateAssetDto,
  ImportAssetRowDto,
  ImportAssetsDto,
  ListAssetDto,
  UpdateAssetDto,
} from '../../src/modules/dto/asset.dto';
import { ListAttendanceDto } from '../../src/modules/dto/attendance.dto';
import { ListAuditDto } from '../../src/modules/dto/audit.dto';
import {
  ImportEmployeeRowDto,
  ImportEmployeesDto,
  ListEmployeesDto,
  UpdateEmployeeDto,
} from '../../src/modules/dto/employee.dto';
import {
  ImportLeaveBalanceRowDto,
  ImportLeaveBalancesDto,
  LeaveBalanceQueryDto,
  ListLeaveDto,
} from '../../src/modules/dto/leave.dto';
import {
  ImportDeductionRowDto,
  ImportDeductionsDto,
  ListPayrollDto,
} from '../../src/modules/dto/payroll.dto';
import { ImportLoanRowDto, ImportLoansDto } from '../../src/modules/dto/rules.dto';

// A query string is text and an uploaded sheet arrives as plain objects: the @Type() factories
// are what turn them into numbers and row instances before class-validator ever sees them.
// Nothing exercised those factories, so a whole DTO file could sit at 0% functions while its
// validation rules looked covered.

describe('paging query coercion', () => {
  it.each([
    ['ListAnnouncementDto', ListAnnouncementDto],
    ['ListAssetDto', ListAssetDto],
    ['ListAttendanceDto', ListAttendanceDto],
    ['ListAuditDto', ListAuditDto],
    ['ListEmployeesDto', ListEmployeesDto],
    ['ListLeaveDto', ListLeaveDto],
    ['ListPayrollDto', ListPayrollDto],
  ])('%s reads page/pageSize as integers', (_name, Dto) => {
    expect(plainToInstance(Dto, { page: '3', pageSize: '25' })).toMatchObject({
      page: 3,
      pageSize: 25,
    });
  });

  it('reads a leave-balance year as an integer', () => {
    expect(plainToInstance(LeaveBalanceQueryDto, { year: '2026' }).year).toBe(2026);
  });
});

describe('money field coercion', () => {
  it('reads an asset value as a number on create and update', () => {
    expect(plainToInstance(CreateAssetDto, { value: '1500000' }).value).toBe(1500000);
    expect(plainToInstance(UpdateAssetDto, { value: '1200000.5' }).value).toBe(1200000.5);
  });
});

describe('import rows are built as row instances, not plain objects', () => {
  it.each([
    ['allowances', ImportAllowancesDto, ImportAllowanceRowDto],
    ['assets', ImportAssetsDto, ImportAssetRowDto],
    ['employees', ImportEmployeesDto, ImportEmployeeRowDto],
    ['leave balances', ImportLeaveBalancesDto, ImportLeaveBalanceRowDto],
    ['deductions', ImportDeductionsDto, ImportDeductionRowDto],
    ['loans', ImportLoansDto, ImportLoanRowDto],
  ])('%s', (_name, Dto, RowDto) => {
    const dto = plainToInstance(Dto as never, { rows: [{}] }) as unknown as { rows: unknown[] };
    expect(dto.rows[0]).toBeInstanceOf(RowDto as never);
  });

  it('coerces the numeric columns of an imported leave balance', () => {
    const dto = plainToInstance(ImportLeaveBalancesDto, {
      rows: [{ year: '2026', quotaDays: '12', usedDays: '3' }],
    }) as unknown as { rows: ImportLeaveBalanceRowDto[] };
    expect(dto.rows[0]).toMatchObject({ year: 2026, quotaDays: 12, usedDays: 3 });
  });
});

describe('nested announcement targets', () => {
  it('builds each target as a target instance', () => {
    const dto = plainToInstance(CreateAnnouncementDto, {
      title: 'Libur',
      body: 'Depot tutup',
      targets: [{ dimension: 'COMPANY' }],
    });
    expect(dto.targets[0]).toBeInstanceOf(AnnouncementTargetDto);
  });
});

/*
 * `exitDate: null` is the rehire case: an employee who came back still carrying an exit
 * date is paid for no days at all, because payroll clamps the period to joinDate..exitDate.
 * The validator has to let the null through while still rejecting nonsense.
 */
describe('UpdateEmployeeDto.exitDate', () => {
  it('accepts an explicit null', async () => {
    const dto = plainToInstance(UpdateEmployeeDto, { exitDate: null });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts an ISO date and rejects a non-date string', async () => {
    await expect(
      validate(plainToInstance(UpdateEmployeeDto, { exitDate: '2026-08-10T00:00:00.000Z' })),
    ).resolves.toEqual([]);
    await expect(
      validate(plainToInstance(UpdateEmployeeDto, { exitDate: 'kemarin' })),
    ).resolves.not.toEqual([]);
  });
});
