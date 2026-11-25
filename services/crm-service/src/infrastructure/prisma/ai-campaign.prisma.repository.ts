import { Injectable } from '@nestjs/common';

import { AiCampaignRepository, CampaignTotals } from '../../application/ports/ai-campaign.repository';
import { PrismaService } from './prisma.service';

/** A campaign has finished sending once it is SENT or COMPLETED_WITH_FAILURES; only then are its counts final. */
const FINISHED = ['SENT', 'COMPLETED_WITH_FAILURES'] as const;

/** HD-6 H4 part 2: plain Prisma reads on the (status, sentAt) index. */
@Injectable()
export class AiCampaignPrismaRepository implements AiCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  async totals(from: Date, to: Date): Promise<CampaignTotals> {
    const campaign = { status: { in: [...FINISHED] }, sentAt: { gte: from, lt: to } };
    const [campaigns, byStatus] = await Promise.all([
      this.prisma.campaign.count({ where: campaign }),
      this.prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaign }, _count: { _all: true } }),
    ]);
    const n = (status: string): number => byStatus.find((r) => r.status === status)?._count._all ?? 0;
    const known = n('SENT') + n('FAILED') + n('SKIPPED');
    return {
      campaigns,
      sent: n('SENT'),
      failed: n('FAILED'),
      skipped: n('SKIPPED'),
      other: byStatus.reduce((sum, r) => sum + r._count._all, 0) - known,
    };
  }
}
