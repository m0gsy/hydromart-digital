import { Injectable } from '@nestjs/common';

import { FraudFlagAlreadyOpenError } from '../../domain/errors';
import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';
import {
  CreateFraudFlagData,
  FraudFlagRecord,
  FraudFlagRepository,
  ListFraudFlagsFilter,
} from '../../application/ports/fraud-flag.repository';
import { PrismaService } from './prisma.service';

interface FraudFlagRow {
  id: string;
  entityType: string;
  entityRef: string;
  score: number;
  level: string;
  signals: string[];
  status: string;
  blockedAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
}

@Injectable()
export class FraudFlagPrismaRepository implements FraudFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: FraudFlagRow): FraudFlagRecord {
    return {
      ...row,
      entityType: row.entityType as FraudEntityType,
      level: row.level as FraudLevel,
      status: row.status as FraudStatus,
      blockedAt: row.blockedAt,
    };
  }

  async list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]> {
    const where = {
      ...(filter.level ? { level: filter.level } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const rows = await this.prisma.fraudFlag.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateFraudFlagData): Promise<FraudFlagRecord> {
    try {
      const row = await this.prisma.fraudFlag.create({ data });
      return this.toRecord(row);
    } catch (error) {
      // The partial unique index (one OPEN flag per entity) picked the other writer.
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new FraudFlagAlreadyOpenError(data.entityRef);
      }
      throw error;
    }
  }

  async clear(
    id: string,
    reason: string | null,
  ): Promise<{ flag: FraudFlagRecord; previous: FraudStatus; reinstate: boolean } | null> {
    const found = await this.prisma.fraudFlag.findUnique({ where: { id } });
    if (!found) return null;
    return this.prisma.$transaction(async (tx) => {
      // One lock per entity: clears and the count below serialise on it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fraud:${found.entityRef}`}, 0))`;
      const existing = await tx.fraudFlag.findUnique({ where: { id } });
      if (!existing) return null;
      const row = await tx.fraudFlag.update({
        where: { id },
        data: { status: FraudStatus.CLEARED, decisionReason: reason },
      });
      let reinstate = false;
      if (existing.entityType === 'ACCOUNT' && existing.blockedAt) {
        const others = await tx.fraudFlag.count({
          where: { entityRef: existing.entityRef, status: FraudStatus.BLOCKED, id: { not: id } },
        });
        reinstate = others === 0;
      }
      return { flag: this.toRecord(row), previous: existing.status as FraudStatus, reinstate };
    });
  }

  async findById(id: string): Promise<FraudFlagRecord | null> {
    const row = await this.prisma.fraudFlag.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async countBlockedFor(entityRef: string, excludeId: string): Promise<number> {
    return this.prisma.fraudFlag.count({
      where: { entityRef, status: FraudStatus.BLOCKED, id: { not: excludeId } },
    });
  }

  async setStatus(
    id: string,
    status: FraudStatus,
    reason?: string | null,
  ): Promise<FraudFlagRecord | null> {
    const existing = await this.prisma.fraudFlag.findUnique({ where: { id } });
    if (!existing) return null;
    // ADM-8: stamped when it becomes BLOCKED and never cleared — "this flag suspended
    // somebody" is a fact about what happened, not a state that can be undone.
    const row = await this.prisma.fraudFlag.update({
      where: { id },
      data: {
        status,
        // undefined = a system transition (scan sweep) that must not wipe a typed reason.
        ...(reason !== undefined ? { decisionReason: reason } : {}),
        ...(status === FraudStatus.BLOCKED && !existing.blockedAt ? { blockedAt: new Date() } : {}),
      },
    });
    return this.toRecord(row);
  }
}
