import { ConflictException } from '@nestjs/common';

import { PayrollService } from '../../src/application/services/payroll.service';
import { DepotAssignmentPrismaRepository } from '../../src/infrastructure/prisma/depot-assignment.prisma.repository';

const hq = { sub: 'hr-1', role: 'HR' } as never;
const GENERATED = new Date('2026-10-02T03:00:00.000Z');

function build(opts: { moved?: boolean; flag?: boolean; noGuard?: boolean }) {
  const setStatus = jest.fn(async (id: string) => ({ id, status: 'APPROVED' }));
  const repo = {
    findById: async () => ({
      id: 'p1', employeeId: 'e1', periodMonth: '2026-09', status: 'DRAFT', updatedAt: GENERATED,
    }),
    setStatus,
  };
  const movedSince = jest.fn(async () => opts.moved === true);
  const ledger: Record<string, unknown> = { movedSince };
  if (opts.noGuard) delete ledger.movedSince;
  const svc = new PayrollService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    { findByIdInternal: async () => ({ id: 'e1', depotId: 'd1', homeDepotId: 'd1' }), getById: async () => ({ id: 'e1' }) } as never,
    { depotAssignmentEnabled: opts.flag ?? true } as never,
    undefined, undefined, undefined, undefined, undefined, undefined,
    ledger as never,
  );
  return { svc, setStatus, movedSince };
}

describe('approving a slip whose depot ledger moved after it was generated', () => {
  it('is refused with a way out: regenerate first', async () => {
    const { svc, setStatus, movedSince } = build({ moved: true });
    await expect(svc.approve(hq, 'p1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.approve(hq, 'p1')).rejects.toThrow(/Hitung ulang/);
    expect(setStatus).not.toHaveBeenCalled();
    // asked about the days up to the END of the slip's month, since the slip was written
    expect(movedSince).toHaveBeenCalledWith('e1', GENERATED, new Date('2026-09-30T00:00:00.000Z'));
  });

  it('goes through when nothing moved', async () => {
    const { svc, setStatus } = build({ moved: false });
    await expect(svc.approve(hq, 'p1')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(setStatus).toHaveBeenCalled();
  });

  it('is not asked at all with the feature off, or by a repository without the guard', async () => {
    const off = build({ moved: true, flag: false });
    await off.svc.approve(hq, 'p1');
    expect(off.movedSince).not.toHaveBeenCalled();
    const bare = build({ moved: true, noGuard: true });
    await expect(bare.svc.approve(hq, 'p1')).resolves.toBeDefined();
  });
});

describe('DepotAssignmentPrismaRepository.movedSince', () => {
  it('counts moves written after the slip that take effect inside its month', async () => {
    const count = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const repo = new DepotAssignmentPrismaRepository({ employeeDepotMove: { count } } as never);
    const through = new Date('2026-09-30T00:00:00.000Z');
    await expect(repo.movedSince!('e1', GENERATED, through)).resolves.toBe(true);
    await expect(repo.movedSince!('e1', GENERATED, through)).resolves.toBe(false);
    expect(count.mock.calls[0][0]).toEqual({
      where: { employeeId: 'e1', createdAt: { gt: GENERATED }, effectiveDate: { lte: through } },
    });
  });
});
