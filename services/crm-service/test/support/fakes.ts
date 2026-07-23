import { randomUUID } from 'node:crypto';

import { CampaignChannel } from '../../src/domain/channel';
import { CampaignStatus } from '../../src/domain/campaign-status';
import { RecipientStatus } from '../../src/domain/recipient-status';
import {
  CampaignRecipientRecord,
  CampaignRecord,
  CampaignRepository,
  CreateCampaignData,
} from '../../src/application/ports/campaign.repository';
import {
  BroadcastForCourier,
  BroadcastRecord,
  BroadcastRepository,
  CreateBroadcastData,
} from '../../src/application/ports/broadcast.repository';
import { SegmentUnavailableError } from '../../src/domain/errors';
import { WhatsappBroadcastPort } from '../../src/application/ports/whatsapp-broadcast.port';
import {
  CustomerDirectoryPort,
  DirectoryRecipient,
  SegmentFilter,
} from '../../src/application/ports/customer-directory.port';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
  RecordNotificationData,
} from '../../src/application/ports/notification.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryCampaignRepository implements CampaignRepository {
  campaigns: CampaignRecord[] = [];

  private clone(c: CampaignRecord): CampaignRecord {
    return { ...c, recipients: c.recipients.map((r) => ({ ...r })) };
  }

  async create(data: CreateCampaignData): Promise<CampaignRecord> {
    const now = nextDate();
    const id = randomUUID();
    const recipients: CampaignRecipientRecord[] = data.recipients.map((r) => ({
      id: randomUUID(),
      campaignId: id,
      customerId: r.customerId ?? null,
      phone: r.phone,
      name: r.name ?? null,
      status: RecipientStatus.PENDING,
      error: null,
      sentAt: null,
      createdAt: nextDate(),
    }));
    const campaign: CampaignRecord = {
      id,
      name: data.name,
      channel: CampaignChannel.WHATSAPP,
      messageTemplate: data.messageTemplate,
      status: CampaignStatus.DRAFT,
      totalRecipients: recipients.length,
      sentCount: 0,
      failedCount: 0,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      recipients,
    };
    this.campaigns.push(campaign);
    return this.clone(campaign);
  }

  async findById(id: string): Promise<CampaignRecord | null> {
    const c = this.campaigns.find((x) => x.id === id);
    return c ? this.clone(c) : null;
  }

  async findByIdRecipients(id: string): Promise<CampaignRecipientRecord[]> {
    const c = this.campaigns.find((x) => x.id === id);
    return c ? c.recipients.map((r) => ({ ...r })) : [];
  }

  async list(page: number, limit: number): Promise<{ items: CampaignRecord[]; total: number }> {
    const all = [...this.campaigns].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const start = (page - 1) * limit;
    return {
      items: all.slice(start, start + limit).map((c) => ({ ...this.clone(c), recipients: [] })),
      total: all.length,
    };
  }

  async markSending(id: string): Promise<void> {
    const c = this.campaigns.find((x) => x.id === id);
    if (c) {
      c.status = CampaignStatus.SENDING;
      c.updatedAt = nextDate();
    }
  }

  async recordRecipientResult(
    recipientId: string,
    status: RecipientStatus,
    error: string | null,
    sentAt: Date | null,
  ): Promise<void> {
    for (const c of this.campaigns) {
      const r = c.recipients.find((x) => x.id === recipientId);
      if (r) {
        r.status = status;
        r.error = error;
        r.sentAt = sentAt;
        return;
      }
    }
  }

  async finalize(
    id: string,
    sentCount: number,
    failedCount: number,
    sentAt: Date,
  ): Promise<CampaignRecord> {
    const c = this.campaigns.find((x) => x.id === id);
    if (!c) throw new Error('campaign not found');
    c.status = CampaignStatus.SENT;
    c.sentCount = sentCount;
    c.failedCount = failedCount;
    c.sentAt = sentAt;
    c.updatedAt = nextDate();
    return this.clone(c);
  }
}

export class InMemoryBroadcastRepository implements BroadcastRepository {
  broadcasts: BroadcastRecord[] = [];
  private readonly reads = new Map<string, Date>(); // key: `${broadcastId}:${courierId}`

  async create(data: CreateBroadcastData): Promise<BroadcastRecord> {
    const record: BroadcastRecord = { id: randomUUID(), ...data, createdAt: nextDate() };
    this.broadcasts.push(record);
    return { ...record };
  }

  async findById(id: string): Promise<BroadcastRecord | null> {
    const b = this.broadcasts.find((x) => x.id === id);
    return b ? { ...b } : null;
  }

  async listForCourier(
    depotId: string,
    courierId: string,
    limit: number,
  ): Promise<BroadcastForCourier[]> {
    return this.broadcasts
      .filter((b) => b.depotId === depotId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((b) => ({ ...b, readAt: this.reads.get(`${b.id}:${courierId}`) ?? null }));
  }

  async markRead(broadcastId: string, courierId: string, readAt: Date): Promise<void> {
    const key = `${broadcastId}:${courierId}`;
    if (!this.reads.has(key)) this.reads.set(key, readAt); // upsert: first read wins
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  records: NotificationRecord[] = [];

  async record(data: RecordNotificationData): Promise<NotificationRecord> {
    const rec: NotificationRecord = { id: randomUUID(), ...data, createdAt: nextDate() };
    this.records.push(rec);
    return { ...rec };
  }

  async listForCustomer(customerId: string, limit: number): Promise<NotificationRecord[]> {
    return this.records
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  /** `${notificationId}:${staffId}` → readAt. */
  reads = new Map<string, Date>();

  private window(events: string[], limit: number): NotificationRecord[] {
    return this.records
      .filter((r) => events.includes(r.event))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listOpsFeedFor(events: string[], staffId: string, limit: number): Promise<OpsNotificationRecord[]> {
    return this.window(events, limit).map((r) => ({ ...r, readAt: this.reads.get(`${r.id}:${staffId}`) ?? null }));
  }

  async markOpsRead(notificationId: string, events: string[], staffId: string): Promise<Date | null> {
    const found = this.records.find((r) => r.id === notificationId && events.includes(r.event));
    if (!found) return null;
    const key = `${notificationId}:${staffId}`;
    const existing = this.reads.get(key);
    if (existing) return existing;
    const readAt = nextDate();
    this.reads.set(key, readAt);
    return readAt;
  }

  async markAllOpsRead(events: string[], staffId: string, limit: number): Promise<number> {
    let marked = 0;
    for (const r of this.window(events, limit)) {
      const key = `${r.id}:${staffId}`;
      if (this.reads.has(key)) continue;
      this.reads.set(key, nextDate());
      marked += 1;
    }
    return marked;
  }
}

/** Directory fake: returns a seeded audience, filtered by tier/city. Throws if `down`. */
export class FakeCustomerDirectory implements CustomerDirectoryPort {
  recipients: (DirectoryRecipient & { tier?: string; city?: string })[] = [];
  down = false;
  lastAuth?: string;

  async resolveSegment(filter: SegmentFilter, authorization: string): Promise<DirectoryRecipient[]> {
    if (this.down) throw new SegmentUnavailableError('directory down');
    this.lastAuth = authorization;
    return this.recipients
      .filter((r) => !filter.tier || r.tier === filter.tier)
      .filter((r) => !filter.city || r.city?.toLowerCase() === filter.city.toLowerCase())
      .map(({ customerId, name, phone }) => ({ customerId, name, phone }));
  }
}

/** WhatsApp fake: reports success unless a phone is registered via failOn(...). Never throws. */
export class FakeWhatsappBroadcast implements WhatsappBroadcastPort {
  sent: { phone: string; message: string }[] = [];
  private readonly failPhones = new Set<string>();

  failOn(...phones: string[]): void {
    for (const p of phones) this.failPhones.add(p);
  }

  async send(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
    this.sent.push({ phone, message });
    if (this.failPhones.has(phone)) return { ok: false, error: 'simulated failure' };
    return { ok: true };
  }
}
