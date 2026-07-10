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

  async markSending(id: string): Promise<void> {
    await this.prisma.campaign.update({
      where: { id },
      data: { status: PrismaCampaignStatus.SENDING },
    });
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
