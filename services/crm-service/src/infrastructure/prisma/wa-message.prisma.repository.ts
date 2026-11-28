import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';

import {
  WaMessageInput,
  WaMessageRecord,
  WaMessageRepository,
} from '../../application/ports/wa.repository';
import { PrismaService } from './prisma.service';

interface MessageRow extends Omit<WaMessageRecord, 'vars'> {
  vars: unknown;
}

/** HD-12: the outbound log and outbox for number 1, and the inbound webhook dedupe keys. */
@Injectable()
export class WaMessagePrismaRepository implements WaMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: MessageRow): WaMessageRecord {
    return { ...row, vars: (row.vars ?? {}) as Record<string, string> };
  }

  async insertIfNew(input: WaMessageInput): Promise<boolean> {
    const data = { ...input, vars: input.vars as unknown as Prisma.InputJsonValue };
    const { count } = await this.prisma.waMessage.createMany({ data: [data], skipDuplicates: true });
    return count === 1;
  }

  async findByDedupeKey(dedupeKey: string): Promise<WaMessageRecord | null> {
    const row = await this.prisma.waMessage.findUnique({ where: { dedupeKey } });
    return row ? this.toRecord(row) : null;
  }

  async markSent(id: string, metaMessageId: string, at: Date): Promise<void> {
    await this.prisma.waMessage.update({
      where: { id },
      data: { status: 'SENT', metaMessageId, sentAt: at, attempts: { increment: 1 } },
    });
  }

  async markRetry(id: string): Promise<void> {
    await this.prisma.waMessage.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  async markFailed(id: string, errorCode: string | null, error: string, at: Date): Promise<void> {
    await this.prisma.waMessage.update({
      where: { id },
      data: { status: 'FAILED', errorCode, error: error.slice(0, 500), failedAt: at },
    });
  }

  async cancelQueuedForPhone(phone: string): Promise<number> {
    const { count } = await this.prisma.waMessage.updateMany({
      where: { phone, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    return count;
  }

  async claimQueued(
    limit: number,
    token: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WaMessageRecord[]> {
    // A row another sweep claimed a moment ago is not ours; one claimed long ago (that sweep died) is.
    const free = {
      status: 'QUEUED',
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
    };
    const due = await this.prisma.waMessage.findMany({
      where: free,
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (due.length === 0) return [];
    // The same condition again inside the UPDATE: of two sweeps racing for a row, one gets it.
    await this.prisma.waMessage.updateMany({
      where: { ...free, id: { in: due.map((r) => r.id) } },
      data: { claimToken: token, claimedAt: now },
    });
    const mine = await this.prisma.waMessage.findMany({
      where: { claimToken: token, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return mine.map((r) => this.toRecord(r));
  }

  async recordInbound(eventKey: string, kind: string): Promise<boolean> {
    const { count } = await this.prisma.waInboundEvent.createMany({
      data: [{ eventKey, kind }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async purgeMessagesBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.waMessage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  }

  async purgeInboundBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.waInboundEvent.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    return count;
  }
}
