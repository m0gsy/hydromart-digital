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

  async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.waMessage.update({ where: { id }, data: { status: 'SKIPPED', skipReason: reason } });
  }

  async markCancelled(id: string): Promise<boolean> {
    const { count } = await this.prisma.waMessage.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    return count === 1;
  }

  async applyStatus(
    metaMessageId: string,
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
    at: Date,
    error: { code: string | null; text: string } | null,
  ): Promise<{ record: WaMessageRecord; changed: boolean } | null> {
    const row = await this.prisma.waMessage.findUnique({ where: { metaMessageId } });
    if (!row) return null;
    // What each status may replace: forward only, and FAILED only until the phone has it.
    const from =
      status === 'FAILED' ? ['QUEUED', 'SENT'] : status === 'SENT' ? ['QUEUED'] : status === 'DELIVERED' ? ['QUEUED', 'SENT'] : ['QUEUED', 'SENT', 'DELIVERED'];
    const stamp = { SENT: 'sentAt', DELIVERED: 'deliveredAt', READ: 'readAt', FAILED: 'failedAt' }[status];
    const { count } = await this.prisma.waMessage.updateMany({
      where: { id: row.id, status: { in: from } },
      data: { status, [stamp]: at, ...(error ? { errorCode: error.code, error: error.text.slice(0, 500) } : {}) },
    });
    return { record: this.toRecord(row), changed: count === 1 };
  }

  async lastServiceReplyAt(phone: string): Promise<Date | null> {
    const row = await this.prisma.waMessage.findFirst({
      where: { phone, category: 'SERVICE', status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row ? row.createdAt : null;
  }

  async listProblems(limit: number): Promise<WaMessageRecord[]> {
    const rows = await this.prisma.waMessage.findMany({
      where: { OR: [{ status: 'FAILED' }, { status: 'SKIPPED', skipReason: { not: 'NO_CONSENT' } }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async cancelQueuedForPhone(phone: string): Promise<WaMessageRecord[]> {
    const rows = await this.prisma.waMessage.findMany({ where: { phone, status: 'QUEUED' }, take: 500 });
    if (rows.length === 0) return [];
    // Only the rows this UPDATE really moved: one a sweep sent a moment ago is SENT now and is not recalled.
    await this.prisma.waMessage.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    const cancelled = await this.prisma.waMessage.findMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'CANCELLED' },
      take: 500,
    });
    return cancelled.map((r) => this.toRecord(r));
  }

  async claimQueued(
    limit: number,
    token: string,
    now: Date,
    staleBefore: Date,
  ): Promise<WaMessageRecord[]> {
    // A row another sweep claimed a moment ago is not ours; one claimed long ago (that sweep died) is.
    // SERVICE replies are sent inline and never retried: a stranded one is not a template to send.
    // And a row younger than 30 s is still being sent by the request that made it (no double send).
    const free = {
      status: 'QUEUED',
      category: { not: 'SERVICE' },
      createdAt: { lt: new Date(now.getTime() - 30_000) },
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
