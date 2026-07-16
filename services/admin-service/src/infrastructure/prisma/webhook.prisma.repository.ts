import { Injectable } from '@nestjs/common';

import {
  CreateWebhookData,
  UpdateWebhookData,
  WebhookRecord,
  WebhookRepository,
} from '../../application/ports/webhook.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class WebhookPrismaRepository implements WebhookRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<WebhookRecord[]> {
    return this.prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(data: CreateWebhookData): Promise<WebhookRecord> {
    return this.prisma.webhookEndpoint.create({ data });
  }

  async update(id: string, data: UpdateWebhookData): Promise<WebhookRecord | null> {
    const existing = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) return null;
    return this.prisma.webhookEndpoint.update({ where: { id }, data });
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.prisma.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) return false;
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return true;
  }
}
