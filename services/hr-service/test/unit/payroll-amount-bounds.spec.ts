import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBonusDto, CreateDeductionDto } from '../../src/modules/dto/payroll.dto';
import { ImportPayrollRowDto } from '../../src/modules/dto/history-import.dto';

// HR-09: the column is Decimal(12,2). An amount above 9,999,999,999 reached the database and came
// back as a 500; the same ceiling ShareCorrectionDto already enforces must stop it at the door.
const EMP = '7d0f5ff1-0b8f-4e1a-9d63-0f4a0f2f9a11';
const MAX = 9_999_999_999;

describe('payroll amount bounds (HR-09)', () => {
  const amountErrors = async (errors: ReturnType<typeof validate>) =>
    (await errors).filter((e) => e.property === 'amount');

  it('a bonus: the ceiling passes, one past it is refused', async () => {
    const base = { employeeId: EMP, type: 'MANUAL' };
    expect(await amountErrors(validate(plainToInstance(CreateBonusDto, { ...base, amount: MAX })))).toHaveLength(0);
    expect(await amountErrors(validate(plainToInstance(CreateBonusDto, { ...base, amount: MAX + 1 })))).not.toHaveLength(0);
  });

  it('a deduction: the ceiling passes, one past it is refused', async () => {
    const base = { employeeId: EMP, type: 'MANUAL' };
    expect(await amountErrors(validate(plainToInstance(CreateDeductionDto, { ...base, amount: MAX })))).toHaveLength(0);
    expect(await amountErrors(validate(plainToInstance(CreateDeductionDto, { ...base, amount: MAX + 1 })))).not.toHaveLength(0);
  });

  it('an imported payslip is bounded the same way', async () => {
    const row = { employeeCode: 'E1', periodMonth: '2026-01', gross: 1, totalBonus: 1, totalDeduction: 1, net: 1 };
    expect(await validate(plainToInstance(ImportPayrollRowDto, { ...row, gross: MAX }))).toHaveLength(0);
    for (const field of ['gross', 'totalBonus', 'totalDeduction', 'net'] as const) {
      const bad = await validate(plainToInstance(ImportPayrollRowDto, { ...row, [field]: MAX + 1 }));
      expect(bad.map((e) => e.property)).toContain(field);
    }
  });
});
