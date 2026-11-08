import { Injectable } from '@nestjs/common';

import {
  EventOutboxRecord,
  EventOutboxRepository,
  EventOutboxStatus,
} from '../../application/ports/event-outbox.repository';
import { Prisma } from '../../../prisma/generated/client';
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

@Injectable()
export class EventOutboxPrismaRepository implements EventOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(row: {
    event: string;
    eventId: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<EventOutboxRecord | null> {
    try {
      const created = await this.prisma.webhookEventOutbox.create({
        data: { ...row, payload: row.payload as Prisma.InputJsonValue },
      });
      return toRecord(created);
    } catch (error) {
      // The unique key on eventId: this event is already recorded, and its first
      // recording owns the send (or the sweep will).
      if ((error as { code?: string })?.code === 'P2002') return null;
      throw error;
    }
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

  async markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    await this.prisma.webhookEventOutbox.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: nextAttemptAt ? 'PENDING' : 'DEAD',
        attempts: { increment: 1 },
        lastError: error.slice(0, 500),
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      },
    });
  }
}
