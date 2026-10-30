import { Injectable } from '@nestjs/common';

import { OtpPurpose } from '../../../domain/otp/otp-purpose.enum';
import {
  CreateOtpTokenData,
  OtpTokenRecord,
  OtpTokenRepository,
} from '../../../application/ports/otp-token.repository';
import { PrismaService } from '../prisma.service';
import { toDomainOtpPurpose, toPrismaOtpPurpose } from '../mappers';

interface OtpTokenRow {
  id: string;
  customerId: string;
  purpose: string;
  codeHash: string;
  targetPhone: string | null;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class OtpTokenPrismaRepository implements OtpTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: OtpTokenRow): OtpTokenRecord {
    return {
      id: row.id,
      customerId: row.customerId,
      purpose: toDomainOtpPurpose(row.purpose as never),
      codeHash: row.codeHash,
      targetPhone: row.targetPhone,
      expiresAt: row.expiresAt,
      attempts: row.attempts,
      consumedAt: row.consumedAt,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateOtpTokenData): Promise<OtpTokenRecord> {
    const row = await this.prisma.otpToken.create({
      data: {
        customerId: data.customerId,
        purpose: toPrismaOtpPurpose(data.purpose),
        codeHash: data.codeHash,
        targetPhone: data.targetPhone ?? null,
        expiresAt: data.expiresAt,
      },
    });
    return this.toRecord(row);
  }

  async issueExclusive(
    data: CreateOtpTokenData,
    cooldownSeconds: number,
    now: Date,
  ): Promise<{ cooldownRemaining: number } | { token: OtpTokenRecord }> {
    const purpose = toPrismaOtpPurpose(data.purpose);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`otp:${data.customerId}:${purpose}`}, 0))`;
      const existing = await tx.otpToken.findFirst({
        where: { customerId: data.customerId, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const sinceIssued = (now.getTime() - existing.createdAt.getTime()) / 1000;
        const remaining = Math.ceil(cooldownSeconds - sinceIssued);
        if (remaining > 0) return { cooldownRemaining: remaining };
        await tx.otpToken.updateMany({
          where: { customerId: data.customerId, purpose, consumedAt: null },
          data: { consumedAt: now },
        });
      }
      const row = await tx.otpToken.create({
        data: {
          customerId: data.customerId,
          purpose,
          codeHash: data.codeHash,
          targetPhone: data.targetPhone ?? null,
          expiresAt: data.expiresAt,
        },
      });
      return { token: this.toRecord(row) };
    });
  }

  async findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null> {
    const row = await this.prisma.otpToken.findFirst({
      where: { customerId, purpose: toPrismaOtpPurpose(purpose), consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toRecord(row) : null;
  }

  async claimAttempt(id: string, maxAttempts: number): Promise<boolean> {
    // One conditional UPDATE: the row itself decides whether a guess was left. `update()`
    // on the id alone would let concurrent verifies each increment past the limit.
    const { count } = await this.prisma.otpToken.updateMany({
      where: { id, consumedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return count > 0;
  }

  async markConsumed(id: string, consumedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.otpToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt },
    });
    return count === 1;
  }

  async consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void> {
    await this.prisma.otpToken.updateMany({
      where: { customerId, purpose: toPrismaOtpPurpose(purpose), consumedAt: null },
      data: { consumedAt: at },
    });
  }
}
