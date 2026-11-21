import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TotpCredentialRecord, TotpRepository } from '../../../application/ports/totp.repository';
import { PrismaService } from '../prisma.service';

/** HD-4: the authenticator rows. See the port for what each guarded write promises. */
@Injectable()
export class TotpPrismaRepository implements TotpRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(customerId: string): Promise<TotpCredentialRecord | null> {
    const row = await this.prisma.totpCredential.findUnique({ where: { customerId } });
    if (!row) return null;
    const { secretSealed, confirmedAt, lastStep, failedAttempts, lockedUntil } = row;
    return { customerId, secretSealed, confirmedAt, lastStep, failedAttempts, lockedUntil };
  }

  async startEnrolment(customerId: string, secretSealed: string): Promise<boolean> {
    try {
      // The delete only removes an UNCONFIRMED row; a confirmed one survives it and makes
      // the create fail on the primary key, which is the answer "already enrolled".
      await this.prisma.$transaction([
        this.prisma.totpCredential.deleteMany({ where: { customerId, confirmedAt: null } }),
        this.prisma.totpCredential.create({ data: { customerId, secretSealed } }),
      ]);
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  confirm(customerId: string, step: number, at: Date, recoveryCodeHashes: string[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.totpCredential.updateMany({
        where: { customerId, confirmedAt: null },
        data: { confirmedAt: at, lastStep: step, failedAttempts: 0, lockedUntil: null },
      });
      if (count !== 1) return false;
      await tx.totpRecoveryCode.createMany({
        data: recoveryCodeHashes.map((codeHash) => ({ customerId, codeHash })),
      });
      return true;
    });
  }

  async acceptStep(customerId: string, step: number): Promise<boolean> {
    const { count } = await this.prisma.totpCredential.updateMany({
      where: {
        customerId,
        confirmedAt: { not: null },
        OR: [{ lastStep: null }, { lastStep: { lt: step } }],
      },
      data: { lastStep: step, failedAttempts: 0, lockedUntil: null },
    });
    return count === 1;
  }

  spendRecoveryCode(customerId: string, codeHash: string, at: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.totpRecoveryCode.updateMany({
        where: { customerId, codeHash, usedAt: null },
        data: { usedAt: at },
      });
      if (count !== 1) return false;
      await tx.totpCredential.updateMany({
        where: { customerId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      return true;
    });
  }

  countRecoveryCodesLeft(customerId: string): Promise<number> {
    return this.prisma.totpRecoveryCode.count({ where: { customerId, usedAt: null } });
  }

  async claimAttempt(customerId: string, now: Date): Promise<number | null> {
    try {
      // UPDATE ... WHERE not locked ... RETURNING: the increment and the lock check are one
      // statement, so every concurrent try gets its own number.
      const { failedAttempts } = await this.prisma.totpCredential.update({
        where: { customerId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      return failedAttempts;
    } catch (error) {
      // P2025: no row matched, which is locked (or reset in the meantime).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
      throw error;
    }
  }

  async lock(customerId: string, until: Date): Promise<void> {
    await this.prisma.totpCredential.updateMany({
      where: { customerId },
      data: { failedAttempts: 0, lockedUntil: until },
    });
  }

  async remove(customerId: string): Promise<boolean> {
    const { count } = await this.prisma.totpCredential.deleteMany({ where: { customerId } });
    return count === 1;
  }
}
