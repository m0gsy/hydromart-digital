import { PayoutBankAccountPrismaRepository } from '../../src/infrastructure/prisma/bank-account.prisma.repository';
import { PayoutBankAccountController } from '../../src/modules/bank-account.controller';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/*
 * PYO-3. Two rules live in SQL: one account per person (a unique index on `subjectId`, which
 * is what makes `upsert` a replacement rather than a second row), and the PENDING predicate
 * inside the decision's WHERE clause so two reviewers cannot both decide it.
 */
const row = {
  id: 'acc-1',
  subjectId: 'owner-1',
  subjectType: 'OWNER',
  bankName: 'BCA',
  accountNumber: '1234567890',
  accountHolder: 'Budi',
  status: 'PENDING',
  verifiedBy: null,
  verifiedAt: null,
  rejectedReason: null,
  createdAt: new Date('2026-09-17T00:00:00.000Z'),
  updatedAt: new Date('2026-09-17T00:00:00.000Z'),
};

describe('PayoutBankAccountPrismaRepository', () => {
  const payoutBankAccount = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  };
  const repo = new PayoutBankAccountPrismaRepository({ payoutBankAccount } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('registers or replaces one account per person, always back to PENDING', async () => {
    payoutBankAccount.upsert.mockResolvedValue(row);
    await expect(
      repo.upsert({
        subjectId: 'owner-1',
        subjectType: 'OWNER',
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'Budi',
      }),
    ).resolves.toMatchObject({ id: 'acc-1', status: 'PENDING' });

    const fresh = {
      subjectId: 'owner-1',
      subjectType: 'OWNER',
      bankName: 'BCA',
      accountNumber: '1234567890',
      accountHolder: 'Budi',
      status: 'PENDING',
      verifiedBy: null,
      verifiedAt: null,
      rejectedReason: null,
    };
    expect(payoutBankAccount.upsert).toHaveBeenCalledWith({
      where: { subjectId: 'owner-1' },
      create: fresh,
      update: fresh,
    });
  });

  it('reads one by person or id, lists a status oldest first, and answers null when absent', async () => {
    payoutBankAccount.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    expect((await repo.findBySubject('owner-1'))?.id).toBe('acc-1');
    expect(await repo.findBySubject('nobody')).toBeNull();
    expect((await repo.findById('acc-1'))?.subjectId).toBe('owner-1');
    expect(await repo.findById('gone')).toBeNull();

    payoutBankAccount.findMany.mockResolvedValue([row]);
    expect(await repo.listByStatus('PENDING', 25)).toHaveLength(1);
    expect(payoutBankAccount.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });
  });

  it('decides only while still pending', async () => {
    payoutBankAccount.updateMany.mockResolvedValueOnce({ count: 1 });
    payoutBankAccount.findUnique.mockResolvedValueOnce({ ...row, status: 'VERIFIED' });
    await expect(
      repo.decide('acc-1', { status: 'VERIFIED', verifiedBy: 'fin-1', rejectedReason: null }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
    expect(payoutBankAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'acc-1', status: 'PENDING' },
      data: {
        status: 'VERIFIED',
        verifiedBy: 'fin-1',
        rejectedReason: null,
        verifiedAt: expect.any(Date),
      },
    });

    payoutBankAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.decide('acc-1', { status: 'REJECTED', verifiedBy: 'fin-2', rejectedReason: 'x' }),
    ).resolves.toBeNull();
  });
});

// The self-serve half: one account per caller, and the subject type follows the role.
describe('PayoutBankAccountController', () => {
  const accounts = {
    mine: jest.fn().mockResolvedValue(null),
    register: jest.fn().mockResolvedValue(row),
  };
  const controller = new PayoutBankAccountController(accounts as never);
  const dto = { bankName: 'BCA', accountNumber: '1234567890', accountHolder: 'Budi' };

  beforeEach(() => jest.clearAllMocks());

  it('reads the caller own account, and registers it under the right subject type', async () => {
    await controller.mine({ sub: 'owner-1' } as never);
    expect(accounts.mine).toHaveBeenCalledWith('owner-1');

    await controller.register({ sub: 'owner-1', role: 'FRANCHISE_OWNER' } as never, dto);
    expect(accounts.register).toHaveBeenCalledWith('owner-1', 'OWNER', dto);

    await controller.register({ sub: 'courier-1', role: 'DRIVER' } as never, dto);
    expect(accounts.register).toHaveBeenLastCalledWith('courier-1', 'COURIER', dto);
  });
});
