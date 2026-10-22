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
import {
  DecideLoanRequestDto,
  ListLoanRequestDto,
  SubmitLoanRequestDto,
} from '../../src/modules/dto/loan-request.dto';
import { ListAuditDto } from '../../src/modules/dto/audit.dto';
import {
  ProvisionEmployeeDto,
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

/*
 * Kasbon. The applicant's DTO carries TWO fields and no more (K3): the instalment and the
 * month it starts are the approver's to set, and a field the applicant can fill is a field
 * the applicant can argue about later. No `@Max` on the amount either — the ceiling on a
 * kasbon is a business decision nobody has made, and a number invented in a validator would
 * quietly become that decision.
 */
describe('kasbon DTOs', () => {
  it('accepts an amount and a reason, and nothing else the applicant could set', async () => {
    const dto = plainToInstance(SubmitLoanRequestDto, {
      amount: 500000,
      reason: 'Biaya sekolah anak',
      installmentAmount: 100000,
      startPeriod: '2026-10',
    } as never);
    expect(await validate(dto, { whitelist: true })).toEqual([]);
    // The terms the applicant tried to set do not survive the transform at all — the class
    // declares two properties, so two is what the service is handed.
    expect(Object.keys(dto).sort()).toEqual(['amount', 'reason']);
  });

  it('refuses an amount that is not a whole positive number', async () => {
    for (const amount of [0, -1, 1.5]) {
      const dto = plainToInstance(SubmitLoanRequestDto, { amount, reason: 'x' } as never);
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });

  it('refuses a start period that is not YYYY-MM', async () => {
    for (const startPeriod of ['2026-13', '2026-1', 'Okt 2026', '2026']) {
      const dto = plainToInstance(DecideLoanRequestDto, { approve: true, startPeriod } as never);
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
    const ok = plainToInstance(DecideLoanRequestDto, {
      approve: true,
      startPeriod: '2026-10',
      installmentAmount: 100000,
      seenUpdatedAt: '2026-09-10T00:00:00.000Z',
    } as never);
    expect(await validate(ok)).toEqual([]);
  });

  it('reads the queue page numbers as integers', () => {
    const q = plainToInstance(ListLoanRequestDto, { page: '2', pageSize: '50' } as never);
    expect(q).toMatchObject({ page: 2, pageSize: 50 });
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

describe('ProvisionEmployeeDto role', () => {
  const base = {
    authSubjectId: '11111111-1111-4111-8111-111111111111',
    fullName: 'Kasir',
    phone: '+628990004010',
    position: 'Kasir',
    joinDate: '2026-10-22',
    employmentStatus: 'PERMANENT',
    salaryType: 'MONTHLY',
    monthlyRate: 1000000,
  };
  const errors = async (extra: Record<string, unknown>) =>
    (await validate(plainToInstance(ProvisionEmployeeDto, { ...base, ...extra }))).filter(
      (e) => e.property === 'role',
    );

  it('accepts no role (a custom role has no HR jabatan) and any employable one', async () => {
    expect(await errors({})).toEqual([]);
    expect(await errors({ role: 'FINANCE' })).toEqual([]);
  });

  it('still refuses CUSTOMER and a role it does not know', async () => {
    expect(await errors({ role: 'CUSTOMER' })).toHaveLength(1);
    expect(await errors({ role: 'C_kasir' })).toHaveLength(1);
  });
});
