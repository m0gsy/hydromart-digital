import { Prisma } from '@prisma/client';

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TotpPrismaRepository } from '../../src/infrastructure/prisma/repositories/totp.prisma.repository';

const ID = '9b1f3c2e-0d4a-4c55-8f0e-3a2b1c0d9e8f';
const AT = new Date('2026-11-23T02:00:00.000Z');

function setup() {
  const credential = {
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  const recovery = { createMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() };
  const prisma: Record<string, unknown> = { totpCredential: credential, totpRecoveryCode: recovery };
  // The array form runs the statements; the callback form gets this same client as `tx`.
  prisma.$transaction = jest.fn((arg: unknown): unknown =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]),
  );
  return { credential, recovery, repo: new TotpPrismaRepository(prisma as unknown as PrismaService) };
}

describe('TotpPrismaRepository', () => {
  it('maps a row to the stored record, and nothing to null', async () => {
    const { credential, repo } = setup();
    credential.findUnique.mockResolvedValueOnce(null);
    await expect(repo.find(ID)).resolves.toBeNull();
    credential.findUnique.mockResolvedValueOnce({
      customerId: ID,
      secretSealed: 'v1.a.b.c',
      confirmedAt: AT,
      lastStep: 7,
      failedAttempts: 1,
      lockedUntil: null,
      createdAt: AT,
      updatedAt: AT,
    });
    await expect(repo.find(ID)).resolves.toEqual({
      customerId: ID,
      secretSealed: 'v1.a.b.c',
      confirmedAt: AT,
      lastStep: 7,
      failedAttempts: 1,
      lockedUntil: null,
    });
  });

  it('starts an enrolment over an unconfirmed one; a confirmed one answers false', async () => {
    const { credential, repo } = setup();
    await expect(repo.startEnrolment(ID, 'sealed')).resolves.toBe(true);
    expect(credential.deleteMany).toHaveBeenCalledWith({ where: { customerId: ID, confirmedAt: null } });
    expect(credential.create).toHaveBeenCalledWith({ data: { customerId: ID, secretSealed: 'sealed' } });

    credential.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    await expect(repo.startEnrolment(ID, 'sealed')).resolves.toBe(false);
    credential.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(repo.startEnrolment(ID, 'sealed')).rejects.toThrow('connection lost');
  });

  it('confirms only a pending enrolment, storing the recovery hashes with it', async () => {
    const { credential, recovery, repo } = setup();
    credential.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(repo.confirm(ID, 9, AT, ['h1', 'h2'])).resolves.toBe(true);
    expect(credential.updateMany).toHaveBeenCalledWith({
      where: { customerId: ID, confirmedAt: null },
      data: { confirmedAt: AT, lastStep: 9, failedAttempts: 0, lockedUntil: null },
    });
    expect(recovery.createMany).toHaveBeenCalledWith({
      data: [
        { customerId: ID, codeHash: 'h1' },
        { customerId: ID, codeHash: 'h2' },
      ],
    });

    credential.updateMany.mockResolvedValueOnce({ count: 0 });
    recovery.createMany.mockClear();
    await expect(repo.confirm(ID, 9, AT, ['h1'])).resolves.toBe(false);
    expect(recovery.createMany).not.toHaveBeenCalled();
  });

  it('accepts a step only when it is newer than the last one, in one statement', async () => {
    const { credential, repo } = setup();
    credential.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.acceptStep(ID, 12)).resolves.toBe(true);
    await expect(repo.acceptStep(ID, 12)).resolves.toBe(false);
    expect(credential.updateMany).toHaveBeenCalledWith({
      where: {
        customerId: ID,
        confirmedAt: { not: null },
        OR: [{ lastStep: null }, { lastStep: { lt: 12 } }],
      },
      data: { lastStep: 12, failedAttempts: 0, lockedUntil: null },
    });
  });

  it('spends a recovery code once and then clears the failures', async () => {
    const { credential, recovery, repo } = setup();
    recovery.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.spendRecoveryCode(ID, 'h1', AT)).resolves.toBe(true);
    expect(recovery.updateMany).toHaveBeenCalledWith({
      where: { customerId: ID, codeHash: 'h1', usedAt: null },
      data: { usedAt: AT },
    });
    expect(credential.updateMany).toHaveBeenCalledWith({
      where: { customerId: ID },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    credential.updateMany.mockClear();
    await expect(repo.spendRecoveryCode(ID, 'h1', AT)).resolves.toBe(false);
    expect(credential.updateMany).not.toHaveBeenCalled();
  });

  it('counts the unused recovery codes', async () => {
    const { recovery, repo } = setup();
    recovery.count.mockResolvedValueOnce(4);
    await expect(repo.countRecoveryCodesLeft(ID)).resolves.toBe(4);
    expect(recovery.count).toHaveBeenCalledWith({ where: { customerId: ID, usedAt: null } });
  });

  it('claims a try in one conditional write; locked (no row matched) is null', async () => {
    const { credential, repo } = setup();
    credential.update.mockResolvedValueOnce({ failedAttempts: 3 });
    await expect(repo.claimAttempt(ID, AT)).resolves.toBe(3);
    expect(credential.update).toHaveBeenCalledWith({
      where: { customerId: ID, OR: [{ lockedUntil: null }, { lockedUntil: { lte: AT } }] },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });

    credential.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('none', { code: 'P2025', clientVersion: '5.22.0' }),
    );
    await expect(repo.claimAttempt(ID, AT)).resolves.toBeNull();
    credential.update.mockRejectedValueOnce(new Error('connection lost'));
    await expect(repo.claimAttempt(ID, AT)).rejects.toThrow('connection lost');
  });

  it('locks until a time and starts the count again', async () => {
    const { credential, repo } = setup();
    credential.updateMany.mockResolvedValueOnce({ count: 1 });
    await repo.lock(ID, AT);
    expect(credential.updateMany).toHaveBeenCalledWith({
      where: { customerId: ID },
      data: { failedAttempts: 0, lockedUntil: AT },
    });
  });

  it('removes the authenticator, saying whether there was one', async () => {
    const { credential, repo } = setup();
    credential.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.remove(ID)).resolves.toBe(true);
    await expect(repo.remove(ID)).resolves.toBe(false);
    expect(credential.deleteMany).toHaveBeenCalledWith({ where: { customerId: ID } });
  });
});
