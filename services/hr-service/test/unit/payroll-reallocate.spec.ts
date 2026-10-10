import { BadRequestException, ConflictException } from '@nestjs/common';

import { plainToInstance } from 'class-transformer';

import { PayrollController } from '../../src/modules/payroll.controller';
import { ReallocatePayrollDto, ShareCorrectionDto } from '../../src/modules/dto/payroll.dto';
import { reallocationProblems } from '../../src/domain/payroll-allocation';
import { PayrollPrismaRepository } from '../../src/infrastructure/prisma/payroll.prisma.repository';
import { PayrollService } from '../../src/application/services/payroll.service';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const slip = { gross: 1000, totalBonus: 100, totalDeduction: 50 };
const part = (depotId: string, o: Partial<Record<string, number>> = {}) => ({
  depotId,
  days: 10,
  gross: 500,
  bonus: 50,
  deduction: 25,
  shortfall: 0,
  ...o,
});

describe('reallocationProblems', () => {
  it('accepts a split whose columns add up to the slip', () => {
    expect(reallocationProblems(slip, [part(A), part(B)])).toEqual([]);
  });
  it('names every column that does not add up', () => {
    const r = reallocationProblems(slip, [part(A), part(B, { gross: 400, bonus: 0, deduction: 0 })]);
    expect(r).toEqual([
      expect.stringMatching(/gross 900.*1000/),
      expect.stringMatching(/bonus 50.*100/),
      expect.stringMatching(/potongan 25.*50/),
    ]);
  });
  it('refuses empty, duplicate, negative and fractional parts', () => {
    expect(reallocationProblems(slip, [])).toHaveLength(1);
    expect(reallocationProblems(slip, [part(A), part(A)])).toContainEqual(expect.stringMatching(/sekali/));
    expect(reallocationProblems(slip, [part(A, { days: -1 }), part(B)])).toContainEqual(
      expect.stringMatching(/days/),
    );
    expect(reallocationProblems(slip, [part(A, { gross: 500.5 }), part(B)])).toContainEqual(
      expect.stringMatching(/gross/),
    );
  });
});

describe('PayrollService.reallocate', () => {
  function build(o: { status?: string; flag?: boolean; noRepo?: boolean } = {}) {
    const repo: Record<string, unknown> = {
      findById: async () => ({ id: 'p1', employeeId: 'e1', status: o.status ?? 'APPROVED', gross: 1000, totalBonus: 100, totalDeduction: 50 }),
      findShares: jest.fn(async () => [{ depotId: A, net: 1050 }]),
      replaceShares: jest.fn(async (_i: string, rows: unknown[]) => rows),
    };
    if (o.noRepo) delete repo.replaceShares;
    const audit = { record: jest.fn(async () => undefined) };
    const svc = new PayrollService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      { findByIdInternal: async () => ({ id: 'e1', depotId: A, homeDepotId: A }) } as never,
      { depotAssignmentEnabled: o.flag ?? true } as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      audit as never,
    );
    return { svc, repo, audit };
  }
  const hq = { sub: 'hr-1', role: 'HR' } as never;
  const input = { reason: 'transfer terlambat dicatat', shares: [part(A), part(B)] };

  it('stores the split with net derived and audits before/after/reason', async () => {
    const { svc, repo, audit } = build();
    const r = await svc.reallocate(hq, 'p1', input);
    expect((r as { net: number }[]).map((x) => x.net)).toEqual([525, 525]);
    expect(repo.replaceShares).toHaveBeenCalledWith('p1', expect.any(Array), ['DRAFT', 'APPROVED']);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYROLL_REALLOCATE',
        before: { shares: [{ depotId: A, net: 1050 }] },
        after: expect.objectContaining({ reason: 'transfer terlambat dicatat' }),
      }),
    );
  });
  it('refuses PAID, refuses when the feature is off, refuses a split that does not add up', async () => {
    await expect(build({ status: 'PAID' }).svc.reallocate(hq, 'p1', input)).rejects.toBeInstanceOf(ConflictException);
    await expect(build({ flag: false }).svc.reallocate(hq, 'p1', input)).rejects.toBeInstanceOf(ConflictException);
    await expect(build({ noRepo: true }).svc.reallocate(hq, 'p1', input)).rejects.toBeInstanceOf(ConflictException);
    const bad = { ...input, shares: [part(A)] };
    const { svc, repo } = build();
    await expect(svc.reallocate(hq, 'p1', bad)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.replaceShares).not.toHaveBeenCalled();
  });
  it('refuses a blank reason', async () => {
    await expect(build().svc.reallocate(hq, 'p1', { ...input, reason: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PayrollPrismaRepository.replaceShares', () => {
  const D = (n: number) => ({ toNumber: () => n, valueOf: () => n }) as never;
  const row = (n: number) => ({ depotId: A, days: 1, gross: D(n), bonus: D(0), deduction: D(0), shortfall: D(0), net: D(n) });

  it('swaps the whole split in one guarded update and returns numbers', async () => {
    const update = jest.fn().mockResolvedValue({ shares: [row(7)] });
    const repo = new PayrollPrismaRepository({ payroll: { update } } as never, {} as never);
    const write = { depotId: A, days: 1, gross: 7, bonus: 0, deduction: 0, shortfall: 0, net: 7 };
    await expect(repo.replaceShares('p1', [write], ['DRAFT', 'APPROVED'])).resolves.toEqual([write]);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 'p1', status: { in: ['DRAFT', 'APPROVED'] } },
      data: { shares: { deleteMany: {}, create: [write] } },
    });
  });

  it('a slip that changed status under us is a 409', async () => {
    const update = jest.fn().mockRejectedValue({ code: 'P2025' });
    const repo = new PayrollPrismaRepository({ payroll: { update } } as never, {} as never);
    await expect(repo.replaceShares('p1', [], ['DRAFT'])).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('POST payroll/:id/reallocate-shares', () => {
  it('turns the body into typed share rows and hands it to the service', async () => {
    const dto = plainToInstance(ReallocatePayrollDto, { reason: 'koreksi', shares: [part(A)] });
    expect(dto.shares[0]).toBeInstanceOf(ShareCorrectionDto);
    const reallocate = jest.fn().mockResolvedValue([]);
    const user = { sub: 'u' } as never;
    await new PayrollController({ reallocate } as never).reallocate('p1', dto, user);
    expect(reallocate).toHaveBeenCalledWith(user, 'p1', dto);
  });
});
