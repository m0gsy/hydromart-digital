import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SegmentFilter } from '../../application/ports/customer-directory.port';
import {
  SavedSegmentRecord,
  SavedSegmentRepository,
} from '../../application/ports/saved-segment.repository';
import { PrismaService } from './prisma.service';

interface SavedSegmentRow {
  id: string;
  name: string;
  conditions: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SavedSegmentPrismaRepository implements SavedSegmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SavedSegmentRow): SavedSegmentRecord {
    return { ...row, conditions: (row.conditions ?? {}) as SegmentFilter };
  }

  async list(limit: number): Promise<SavedSegmentRecord[]> {
    const rows = await this.prisma.savedSegment.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<SavedSegmentRecord | null> {
    const row = await this.prisma.savedSegment.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async upsertByName(data: {
    name: string;
    conditions: SegmentFilter;
    createdBy: string;
  }): Promise<SavedSegmentRecord> {
    // The filter is a plain bag of optional scalars, but Prisma's Json input type demands
    // an index signature; the cast says "this is JSON" without widening the domain type,
    // which is what keeps the saved shape and the campaign shape the same one.
    const conditions = data.conditions as Prisma.InputJsonObject;
    // One statement, so two people saving the same name concurrently cannot both pass a
    // read-then-write check and leave the unique index to reject the loser with a 500.
    const row = await this.prisma.savedSegment.upsert({
      where: { name: data.name },
      create: { name: data.name, conditions, createdBy: data.createdBy },
      update: { conditions, createdBy: data.createdBy },
    });
    return this.toRecord(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.prisma.savedSegment.findUnique({ where: { id } });
    if (!existing) return false;
    await this.prisma.savedSegment.delete({ where: { id } });
    return true;
  }
}
