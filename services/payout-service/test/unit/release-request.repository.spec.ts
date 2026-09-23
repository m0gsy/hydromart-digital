import { ReleaseRequestPrismaRepository } from '../../src/infrastructure/prisma/release-request.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/*
 * PYO-2. Two guards live in SQL rather than in JavaScript, and both are why this file
 * exists: one PENDING request per owner (a partial unique index, surfaced as P2002), and
 * the PENDING predicate inside the decision's WHERE clause so two approvers cannot both win.
 */
const row = {
  id: 'req-1',
  franchiseOwnerId: 'owner-1',
  bankAccountRef: 'BCA ···· 4821',
  amountAtRequest: '250000',
  requestedBy: 'finance-1',
  status: 'PENDING',
  decidedBy: null,
  decidedAt: null,
  reason: null,
  withdrawalId: null,
  createdAt: new Date('2026-09-17T00:00:00.000Z'),
};

describe('ReleaseRequestPrismaRepository', () => {
  const hqReleaseRequest = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const repo = new ReleaseRequestPrismaRepository({ hqReleaseRequest } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('creates a request and maps the decimal amount', async () => {
    hqReleaseRequest.create.mockResolvedValue(row);
    await expect(
      repo.create({
        franchiseOwnerId: 'owner-1',
        bankAccountRef: 'BCA ···· 4821',
        amountAtRequest: 250000,
        requestedBy: 'finance-1',
      }),
    ).resolves.toMatchObject({ id: 'req-1', amountAtRequest: 250000, status: 'PENDING' });
  });

  it('answers null when one is already pending for that owner, and rethrows anything else', async () => {
    hqReleaseRequest.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      repo.create({ franchiseOwnerId: 'owner-1', bankAccountRef: null, amountAtRequest: 1, requestedBy: 'f' }),
    ).resolves.toBeNull();

    const boom = new Error('connection lost');
    hqReleaseRequest.create.mockRejectedValueOnce(boom);
    await expect(
      repo.create({ franchiseOwnerId: 'owner-1', bankAccountRef: null, amountAtRequest: 1, requestedBy: 'f' }),
    ).rejects.toBe(boom);
  });

  it('reads one, lists a status oldest first, and answers null for a missing id', async () => {
    hqReleaseRequest.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    expect((await repo.findById('req-1'))?.requestedBy).toBe('finance-1');
    expect(await repo.findById('gone')).toBeNull();

    hqReleaseRequest.findMany.mockResolvedValue([row]);
    expect(await repo.listByStatus('PENDING', 50)).toHaveLength(1);
    expect(hqReleaseRequest.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
  });

  it('decides only while still pending — the loser changes nothing', async () => {
    hqReleaseRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    hqReleaseRequest.findUnique.mockResolvedValueOnce({ ...row, status: 'APPROVED', decidedBy: 'dir-1' });
    await expect(
      repo.decide('req-1', { status: 'APPROVED', decidedBy: 'dir-1', reason: null }),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    expect(hqReleaseRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', status: 'PENDING' },
      data: { status: 'APPROVED', decidedBy: 'dir-1', reason: null, decidedAt: expect.any(Date) },
    });

    hqReleaseRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.decide('req-1', { status: 'REJECTED', decidedBy: 'dir-2', reason: 'no' }),
    ).resolves.toBeNull();
  });

  it('links the withdrawal it produced, and reopens only an unpaid approval', async () => {
    hqReleaseRequest.update.mockResolvedValue({ ...row, withdrawalId: 'wd-1' });
    await expect(repo.attachWithdrawal('req-1', 'wd-1')).resolves.toMatchObject({
      withdrawalId: 'wd-1',
    });

    hqReleaseRequest.updateMany.mockResolvedValue({ count: 1 });
    await repo.reopen('req-1');
    expect(hqReleaseRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'req-1', status: 'APPROVED', withdrawalId: null },
      data: { status: 'PENDING', decidedBy: null, decidedAt: null, reason: null },
    });
  });
});
