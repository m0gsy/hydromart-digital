import { Injectable } from '@nestjs/common';

import {
  OutboxMessageRecord,
  OutboxRepository,
  OutboxStatus,
  OutboxTopic,
} from '../../application/ports/outbox.repository';
import { PrismaService } from './prisma.service';

interface OutboxRow {
  id: string;
  topic: string;
  orderId: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
}

function toRecord(row: OutboxRow): OutboxMessageRecord {
  return {
    id: row.id,
    topic: row.topic as OutboxTopic,
    orderId: row.orderId,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class OutboxPrismaRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimDue(now: Date, limit: number): Promise<OutboxMessageRecord[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async markDone(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { status: 'DONE', lastError: null },
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: {
        // No next attempt means the retries are spent: DEAD, so it stops being counted as
        // work still coming and starts being counted as work somebody has to look at.
        status: nextAttemptAt ? 'PENDING' : 'DEAD',
        attempts: { increment: 1 },
        lastError: error.slice(0, 500),
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      },
    });
  }

  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const grouped = await this.prisma.outboxMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<OutboxStatus, number> = { PENDING: 0, DONE: 0, DEAD: 0 };
    for (const row of grouped) counts[row.status as OutboxStatus] = row._count._all;
    return counts;
  }
}
