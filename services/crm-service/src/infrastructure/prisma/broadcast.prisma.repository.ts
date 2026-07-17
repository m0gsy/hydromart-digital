import { Injectable } from '@nestjs/common';

import { BroadcastLevel } from '../../domain/broadcast-level';
import {
  BroadcastForCourier,
  BroadcastRecord,
  BroadcastRepository,
  CreateBroadcastData,
} from '../../application/ports/broadcast.repository';
import { BroadcastLevel as PrismaBroadcastLevel } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

interface BroadcastRow {
  id: string;
  depotId: string;
  title: string;
  body: string;
  level: string;
  createdBy: string;
  createdAt: Date;
}

@Injectable()
export class BroadcastPrismaRepository implements BroadcastRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: BroadcastRow): BroadcastRecord {
    return { ...row, level: row.level as BroadcastLevel };
  }

  async create(data: CreateBroadcastData): Promise<BroadcastRecord> {
    const row = await this.prisma.depotBroadcast.create({
      data: {
        depotId: data.depotId,
        title: data.title,
        body: data.body,
        level: data.level as unknown as PrismaBroadcastLevel,
        createdBy: data.createdBy,
      },
    });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<BroadcastRecord | null> {
    const row = await this.prisma.depotBroadcast.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async listForCourier(
    depotId: string,
    courierId: string,
    limit: number,
  ): Promise<BroadcastForCourier[]> {
    const rows = await this.prisma.depotBroadcast.findMany({
      where: { depotId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { reads: { where: { courierId }, select: { readAt: true } } },
    });
    return rows.map((row) => ({
      ...this.toRecord(row),
      readAt: row.reads[0]?.readAt ?? null,
    }));
  }

  async markRead(broadcastId: string, courierId: string, readAt: Date): Promise<void> {
    await this.prisma.depotBroadcastRead.upsert({
      where: { broadcastId_courierId: { broadcastId, courierId } },
      create: { broadcastId, courierId, readAt },
      update: {},
    });
  }
}
