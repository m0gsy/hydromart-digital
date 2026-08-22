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

  /**
   * B10. This was called `claimDue`, and it claims nothing: it is a `findMany` over PENDING
   * rows that are due. The name promised a lock that was never taken, and the schema
   * comment beside the index called it "the claim predicate".
   *
   * The lock is not missing by accident — `OutboxService.processDue` says so out loud:
   * every handler is idempotent on the receiving side, keyed by order id, so a redelivery
   * costs a wasted call and never a double consume or a double credit. That is what makes
   * overlapping sweeps safe, and the sweep script locks per job on top of it.
   *
   * So the defect was the WORD, not the behaviour, and the honest fix is the word. Adding a
   * real claim here would build a mechanism the design deliberately decided against — and
   * a name that lies is how the next person builds on a guarantee nobody ever made.
   */
  async findDue(now: Date, limit: number): Promise<OutboxMessageRecord[]> {
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

  /**
   * C3. Scoped to PENDING on purpose: a DONE row already landed, and the void reverses
   * those effects explicitly (restock, points, owner ledger). Re-marking them would erase
   * the record that they ever ran.
   */
  async cancelForOrder(orderId: string, reason: string): Promise<number> {
    const { count } = await this.prisma.outboxMessage.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: reason.slice(0, 500) },
    });
    return count;
  }

  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const grouped = await this.prisma.outboxMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<OutboxStatus, number> = { PENDING: 0, DONE: 0, DEAD: 0, CANCELLED: 0 };
    for (const row of grouped) counts[row.status as OutboxStatus] = row._count._all;
    return counts;
  }
}
