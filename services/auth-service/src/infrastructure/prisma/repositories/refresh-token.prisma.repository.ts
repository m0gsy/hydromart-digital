import { Injectable } from '@nestjs/common';

import {
  CreateRefreshTokenData,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../../application/ports/refresh-token.repository';
import { PrismaService } from '../prisma.service';

/** Thrown inside the rotation transaction to roll it back when the old token was already revoked. */
class RotationLost extends Error {}

@Injectable()
export class RefreshTokenPrismaRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({ data });
  }

  async rotate(
    oldId: string,
    at: Date,
    data: CreateRefreshTokenData,
  ): Promise<RefreshTokenRecord | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Shared lock on the customer: any number of rotations may run together, but
        // `revokeAllForCustomer` (FOR UPDATE below) waits for them, and they wait for it.
        await tx.$queryRaw`SELECT 1 FROM customers WHERE id = ${data.customerId}::uuid FOR SHARE`;
        const child = await tx.refreshToken.create({ data });
        const claimed = await tx.refreshToken.updateMany({
          where: { id: oldId, revokedAt: null },
          data: { revokedAt: at, replacedById: child.id },
        });
        // Lost the race: undo the child, hand back "nothing minted".
        if (claimed.count === 0) throw new RotationLost();
        return child;
      });
    } catch (error) {
      if (error instanceof RotationLost) return null;
      throw error;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revoke(id: string, at: Date, replacedById?: string): Promise<void> {
    // Conditional: a revoke must not stamp over a token a concurrent rotation already
    // revoked — that would erase its `replacedById`, the evidence the grace window reads.
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, replacedById: replacedById ?? null },
    });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    // Same serialisation as revokeAllForCustomer: the theft response must not miss a child a
    // concurrent rotation of this family is inserting. The customer is found through the family.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1 FROM customers WHERE id = (
          SELECT "customerId" FROM refresh_tokens WHERE "familyId" = ${familyId}::uuid LIMIT 1
        ) FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      });
    });
  }

  async revokeAllForCustomer(customerId: string, at: Date): Promise<void> {
    // Exclusive lock on the customer first: it waits for any in-flight rotation (which holds
    // the shared lock) to commit, so the sweep below sees the child that rotation inserted.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { customerId, revokedAt: null },
        data: { revokedAt: at },
      });
    });
  }

  async listActiveForCustomer(customerId: string, now: Date): Promise<RefreshTokenRecord[]> {
    return this.prisma.refreshToken.findMany({
      where: { customerId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
