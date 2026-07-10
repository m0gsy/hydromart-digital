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
        expiresAt: data.expiresAt,
      },
    });
    return this.toRecord(row);
  }

  async findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null> {
    const row = await this.prisma.otpToken.findFirst({
      where: { customerId, purpose: toPrismaOtpPurpose(purpose), consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toRecord(row) : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.prisma.otpToken.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    await this.prisma.otpToken.update({ where: { id }, data: { consumedAt } });
  }

  async consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void> {
    await this.prisma.otpToken.updateMany({
      where: { customerId, purpose: toPrismaOtpPurpose(purpose), consumedAt: null },
      data: { consumedAt: at },
    });
  }
}
