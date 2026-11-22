import { Injectable } from '@nestjs/common';

import {
  EventOutboxRecord,
  EventOutboxRepository,
  EventOutboxStatus,
} from '../../application/ports/event-outbox.repository';
import { PrismaService } from './prisma.service';

interface Row {
  id: string;
  event: string;
  eventId: string;
  payload: unknown;
  occurredAt: Date;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}

function toRecord(row: Row): EventOutboxRecord {
  return {
    id: row.id,
    event: row.event,
    eventId: row.eventId,
    payload: row.payload as Record<string, unknown>,
    occurredAt: row.occurredAt,
    status: row.status as EventOutboxStatus,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
  };
}

/** HD-7: depot-service's webhook outbox (rows are written by the transaction that owes them). */
@Injectable()
export class EventOutboxPrismaRepository implements EventOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEventId(eventId: string): Promise<EventOutboxRecord | null> {
    const row = await this.prisma.webhookEventOutbox.findUnique({ where: { eventId } });
    return row ? toRecord(row) : null;
  }

  countStuck(cutoff: Date): Promise<number> {
    return this.prisma.webhookEventOutbox.count({
      // When it became owed, not when it happened: an event recorded late is not stuck at birth.
      where: { status: 'PENDING', createdAt: { lte: cutoff } },
    });
  }

  async findDue(now: Date, limit: number): Promise<EventOutboxRecord[]> {
    const rows = await this.prisma.webhookEventOutbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async markDone(id: string): Promise<void> {
    await this.prisma.webhookEventOutbox.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'DONE', lastError: null },
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.prisma.webhookEventOutbox.updateMany({
      where: { id, status: 'PENDING' },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 500), nextAttemptAt },
    });
  }

  async pruneDone(before: Date, limit: number): Promise<number> {
    const rows = await this.prisma.webhookEventOutbox.findMany({
      where: { status: 'DONE', updatedAt: { lt: before } },
      select: { id: true },
      take: limit,
    });
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.webhookEventOutbox.deleteMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'DONE' },
    });
    return count;
  }
}
