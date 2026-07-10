import { Injectable } from '@nestjs/common';

import {
  CreateRefreshTokenData,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../../application/ports/refresh-token.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class RefreshTokenPrismaRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({ data });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string, at: Date, replacedById?: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: at, replacedById: replacedById ?? null },
    });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForCustomer(customerId: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async listActiveForCustomer(customerId: string, now: Date): Promise<RefreshTokenRecord[]> {
    return this.prisma.refreshToken.findMany({
      where: { customerId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
