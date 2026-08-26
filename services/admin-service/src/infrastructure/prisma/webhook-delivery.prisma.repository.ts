import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';

import {
  DueDelivery,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookDeliveryStatus,
  WebhookRecord,
} from '../../application/ports/webhook.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class WebhookDeliveryPrismaRepository implements WebhookDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  subscribersOf(event: string): Promise<WebhookRecord[]> {
    return this.prisma.webhookEndpoint.findMany({ where: { active: true, events: { has: event } } });
  }

  async queue(
    rows: { endpointId: string; event: string; payload: unknown; occurredAt: Date }[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.webhookDelivery.createMany({
      data: rows.map((r) => ({
        endpointId: r.endpointId,
        event: r.event,
        payload: r.payload as Prisma.InputJsonValue,
        occurredAt: r.occurredAt,
      })),
    });
    return count;
  }

  /**
   * Claim by writing first, read second. `updateMany` with the due predicate in the WHERE
   * is what makes the claim exclusive — two sweeps that overlap (a slow run and the next
   * cron tick) would otherwise both read the same rows and send every event twice.
   */
  async claimDue(now: Date, limit: number, leaseMs: number): Promise<DueDelivery[]> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    const lease = new Date(now.getTime() + leaseMs);
    const { count } = await this.prisma.webhookDelivery.updateMany({
      where: { id: { in: ids }, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: lease },
    });
    if (count === 0) return [];
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: ids }, nextAttemptAt: lease },
      include: { endpoint: { select: { url: true, secret: true } } },
    });
    return rows.map((r) => ({ ...toRecord(r), url: r.endpoint.url, secret: r.endpoint.secret }));
  }

  async markDelivered(id: string, responseStatus: number, at: Date): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        deliveredAt: at,
        responseStatus,
        lastError: null,
        attempts: { increment: 1 },
      },
    });
  }

  async markRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string,
    responseStatus: number | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'PENDING', attempts, nextAttemptAt, lastError: error, responseStatus },
    });
  }

  async markDead(
    id: string,
    attempts: number,
    error: string,
    responseStatus: number | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'DEAD', attempts, lastError: error, responseStatus },
    });
  }

  async endpointStats(endpointId: string): Promise<{
    delivered: number;
    attempted: number;
    lastStatus: WebhookDeliveryStatus | null;
  }> {
    const [delivered, attempted, last] = await Promise.all([
      this.prisma.webhookDelivery.count({ where: { endpointId, status: 'DELIVERED' } }),
      this.prisma.webhookDelivery.count({ where: { endpointId, attempts: { gt: 0 } } }),
      this.prisma.webhookDelivery.findFirst({
        where: { endpointId, attempts: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      }),
    ]);
    return {
      delivered,
      attempted,
      lastStatus: (last?.status as WebhookDeliveryStatus) ?? null,
    };
  }

  async listForPartner(
    limit: number,
    event?: string,
    apiKeyId?: string,
  ): Promise<WebhookDeliveryRecord[]> {
    // AUTHZ-3: `apiKeyId` present = a partner asking, and they see only the deliveries of
    // the endpoints their own key owns. Absent = HQ (`platformAdmin`), which sees all.
    const where = {
      ...(event ? { event } : {}),
      ...(apiKeyId ? { endpoint: { apiKeyId } } : {}),
    };
    const rows = await this.prisma.webhookDelivery.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async replay(id: string, at: Date, apiKeyId?: string): Promise<WebhookDeliveryRecord | null> {
    // The ownership filter is part of the LOOKUP, not a check after it: another partner's
    // delivery comes back as "not found", which is also all a partner should learn.
    const existing = apiKeyId
      ? await this.prisma.webhookDelivery.findFirst({ where: { id, endpoint: { apiKeyId } } })
      : await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!existing) return null;
    // Attempts reset: a replay is a fresh decision by a human, not a continuation of the
    // backoff that gave up. Otherwise a DEAD row would be dead again on its first try.
    const row = await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: at, lastError: null },
    });
    return toRecord(row);
  }
}

type Row = {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  responseStatus: number | null;
  lastError: string | null;
  occurredAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
};

function toRecord(row: Row): WebhookDeliveryRecord {
  return { ...row, status: row.status as WebhookDeliveryRecord['status'] };
}
