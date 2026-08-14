import { Injectable } from '@nestjs/common';

import { CampaignChannel } from '../../domain/channel';
import { CampaignStatus } from '../../domain/campaign-status';
import { RecipientStatus } from '../../domain/recipient-status';
import {
  CampaignRecipientRecord,
  CampaignRecord,
  CampaignRepository,
  CreateCampaignData,
} from '../../application/ports/campaign.repository';
import {
  CampaignStatus as PrismaCampaignStatus,
  RecipientStatus as PrismaRecipientStatus,
} from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

// Prisma generates enums structurally distinct from the domain enums, so rows are typed
// with `string` enum fields and cast back to the domain enums here (infra only). Writes
// use the generated enum objects for input typing.
interface CampaignRecipientRow {
  id: string;
  campaignId: string;
  customerId: string | null;
  phone: string;
  name: string | null;
  status: string;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

interface CampaignRow {
  id: string;
  name: string;
  channel: string;
  messageTemplate: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  scheduledFor: Date | null;
}

@Injectable()
export class CampaignPrismaRepository implements CampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecipient(row: CampaignRecipientRow): CampaignRecipientRecord {
    return { ...row, status: row.status as RecipientStatus };
  }

  private toCampaign(row: CampaignRow, recipients: CampaignRecipientRow[]): CampaignRecord {
    return {
      ...row,
      channel: row.channel as CampaignChannel,
      status: row.status as CampaignStatus,
      // Rows written before the column existed read as null, which is the pre-scheduling
      // meaning of "due now" — no backfill, no campaign stranded by the migration.
      scheduledFor: row.scheduledFor ?? null,
      recipients: recipients.map((r) => this.toRecipient(r)),
    };
  }

  async create(data: CreateCampaignData): Promise<CampaignRecord> {
    const created = await this.prisma.$transaction((tx) =>
      tx.campaign.create({
        data: {
          name: data.name,
          messageTemplate: data.messageTemplate,
          createdBy: data.createdBy,
          totalRecipients: data.recipients.length,
          scheduledFor: data.scheduledFor ?? null,
          recipients: {
            create: data.recipients.map((r) => ({
              customerId: r.customerId ?? null,
              phone: r.phone,
              name: r.name ?? null,
            })),
          },
        },
        include: { recipients: { orderBy: { createdAt: 'asc' } } },
      }),
    );
    return this.toCampaign(created, created.recipients);
  }

  async findById(id: string): Promise<CampaignRecord | null> {
    const row = await this.prisma.campaign.findUnique({
      where: { id },
      include: { recipients: { orderBy: { createdAt: 'asc' } } },
    });
    return row ? this.toCampaign(row, row.recipients) : null;
  }

  async findByIdRecipients(id: string): Promise<CampaignRecipientRecord[]> {
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toRecipient(r));
  }

  async list(page: number, limit: number): Promise<{ items: CampaignRecord[]; total: number }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.campaign.count(),
    ]);
    // List items omit recipients (not needed for summaries).
    return { items: rows.map((r) => this.toCampaign(r, [])), total };
  }

  /**
   * B-17: the DRAFT predicate lives in the WHERE, not in a prior read. `update({ where:
   * { id } })` let two simultaneous sends both pass the service's canSend() check and both
   * broadcast — to real customers, over WhatsApp, with no way to unsend.
   */
  async markSending(id: string): Promise<boolean> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { id, status: PrismaCampaignStatus.DRAFT },
      data: { status: PrismaCampaignStatus.SENDING },
    });
    return count === 1;
  }

  async findSending(limit: number, now: Date): Promise<CampaignRecord[]> {
    const rows = await this.prisma.campaign.findMany({
      // A scheduled campaign is claimed the moment staff press the button — it is SENDING
      // straight away — but it is not DUE until its time. The sweep is the only place that
      // distinction lives, so a campaign for tomorrow simply is not picked up today.
      where: {
        status: PrismaCampaignStatus.SENDING,
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    // Recipients are claimed in batches by claimRecipients, never loaded wholesale here —
    // a 50,000-recipient campaign must not be read into memory to decide to continue it.
    return rows.map((r) => this.toCampaign(r, []));
  }

  /**
   * The claim, same shape as the webhook dispatcher's: move the rows first with the
   * eligibility predicate in the WHERE, then read back only what this call moved. Reading
   * first and updating after is what lets a slow sweep and the next tick send twice.
   */
  async claimRecipients(campaignId: string, limit: number): Promise<CampaignRecipientRecord[]> {
    const candidates = await this.prisma.campaignRecipient.findMany({
      where: { campaignId, status: PrismaRecipientStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.id);
    await this.prisma.campaignRecipient.updateMany({
      where: { id: { in: ids }, status: PrismaRecipientStatus.PENDING },
      data: { status: PrismaRecipientStatus.SENDING },
    });
    const claimed = await this.prisma.campaignRecipient.findMany({
      where: { id: { in: ids }, status: PrismaRecipientStatus.SENDING },
      orderBy: { createdAt: 'asc' },
    });
    return claimed.map((r) => this.toRecipient(r));
  }

  async tally(campaignId: string): Promise<{ pending: number; sent: number; failed: number }> {
    const rows = await this.prisma.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const of = (s: PrismaRecipientStatus): number =>
      rows.find((r) => r.status === s)?._count._all ?? 0;
    return {
      // A claimed-but-unfinished recipient is still outstanding work, so SENDING counts as
      // pending — otherwise a sweep that dies mid-batch would finalize the campaign and
      // strand those rows forever.
      pending: of(PrismaRecipientStatus.PENDING) + of(PrismaRecipientStatus.SENDING),
      sent: of(PrismaRecipientStatus.SENT),
      failed: of(PrismaRecipientStatus.FAILED),
    };
  }

  async recordRecipientResult(
    recipientId: string,
    status: RecipientStatus,
    error: string | null,
    sentAt: Date | null,
  ): Promise<void> {
    await this.prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: status as unknown as PrismaRecipientStatus, error, sentAt },
    });
  }

  async finalize(
    id: string,
    sentCount: number,
    failedCount: number,
    sentAt: Date,
  ): Promise<CampaignRecord> {
    const row = await this.prisma.campaign.update({
      where: { id },
      data: { status: PrismaCampaignStatus.SENT, sentCount, failedCount, sentAt },
      include: { recipients: { orderBy: { createdAt: 'asc' } } },
    });
    return this.toCampaign(row, row.recipients);
  }
}
