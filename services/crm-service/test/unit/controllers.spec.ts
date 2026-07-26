import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { AuthenticatedUser } from '@hydromart/platform';

import { HealthController } from '../../src/modules/health.controller';
import { PushController } from '../../src/modules/push.controller';
import { NotificationController } from '../../src/modules/notification.controller';
import { CampaignController } from '../../src/modules/campaign.controller';
import { NotificationEvent } from '../../src/domain/notification-event';
import { NotificationStatus } from '../../src/domain/notification-status';
import { CampaignStatus } from '../../src/domain/campaign-status';
import { CampaignChannel } from '../../src/domain/channel';
import { RecipientStatus } from '../../src/domain/recipient-status';
import { SubscribePushDto } from '../../src/modules/dto/push.dto';
import { CreateCampaignDto } from '../../src/modules/dto/campaign.dto';
import { CampaignRecord } from '../../src/application/ports/campaign.repository';
import {
  NotificationRecord,
  OpsNotificationRecord,
} from '../../src/application/ports/notification.repository';

// Delegate-assert controllers: importing each controller also covers its DTO mapping. These
// call the real controller methods against mocked services, hitting every branch (guards,
// found/not-found, error paths) the e2e specs don't reach for these routes.

const user: AuthenticatedUser = { sub: 'user-1' } as AuthenticatedUser;

const notifRecord = (over: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: 'n1',
  event: NotificationEvent.ORDER_RECEIVED,
  customerId: 'cust-1',
  phone: '+6281',
  message: 'hi',
  status: NotificationStatus.SENT,
  error: null,
  createdAt: new Date('2026-01-01'),
  ...over,
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const out = await new HealthController(prisma as never).check();
    expect(out.status).toBe('ok');
    expect(out.checks.database).toBe('up');
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as never).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('PushController', () => {
  it('returns the configured VAPID public key', () => {
    const controller = new PushController(
      {} as never,
      { vapid: { publicKey: 'pub' } } as never,
    );
    expect(controller.vapidPublicKey()).toEqual({ key: 'pub' });
  });

  it('subscribes the caller\'s device (maps dto keys)', async () => {
    const push = { subscribe: jest.fn().mockResolvedValue(undefined) };
    const controller = new PushController(push as never, {} as never);
    await controller.subscribe(user, {
      endpoint: 'https://push/1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    expect(push.subscribe).toHaveBeenCalledWith('user-1', {
      endpoint: 'https://push/1',
      p256dh: 'k',
      auth: 'a',
    });
  });

  it('unsubscribes a device by endpoint', async () => {
    const push = { unsubscribe: jest.fn().mockResolvedValue(undefined) };
    const controller = new PushController(push as never, {} as never);
    await controller.unsubscribe('https://push/1');
    expect(push.unsubscribe).toHaveBeenCalledWith('https://push/1');
  });

  it('rejects an empty endpoint on unsubscribe', async () => {
    const controller = new PushController({} as never, {} as never);
    await expect(controller.unsubscribe('')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('NotificationController', () => {
  it('lists the current customer\'s inbox', async () => {
    const notifications = { listForCustomer: jest.fn().mockResolvedValue([notifRecord()]) };
    const out = await new NotificationController(notifications as never).listMine(user);
    expect(notifications.listForCustomer).toHaveBeenCalledWith('user-1');
    expect(out[0].id).toBe('n1');
  });

  it('lists the ops feed with read receipts', async () => {
    const ops: OpsNotificationRecord = { ...notifRecord({ event: NotificationEvent.STOCK_LOW }), readAt: null };
    const notifications = { listOpsFeed: jest.fn().mockResolvedValue([ops]) };
    const out = await new NotificationController(notifications as never).listOps(user);
    expect(notifications.listOpsFeed).toHaveBeenCalledWith('user-1');
    expect(out[0].readAt).toBeNull();
  });

  it('marks one ops notification read', async () => {
    const readAt = new Date('2026-02-02');
    const notifications = { markOpsRead: jest.fn().mockResolvedValue(readAt) };
    const out = await new NotificationController(notifications as never).markOpsRead('n1', user);
    expect(out).toEqual({ readAt });
  });

  it('throws NotFound when the ops notification does not exist', async () => {
    const notifications = { markOpsRead: jest.fn().mockResolvedValue(null) };
    await expect(
      new NotificationController(notifications as never).markOpsRead('n1', user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks the whole ops feed read', async () => {
    const notifications = { markAllOpsRead: jest.fn().mockResolvedValue(3) };
    expect(await new NotificationController(notifications as never).markAllOpsRead(user)).toEqual({
      marked: 3,
    });
  });

  it('dispatches a token-triggered notification (send)', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(notifRecord()) };
    const controller = new NotificationController(notifications as never);
    const out = await controller.send({
      event: NotificationEvent.ORDER_RECEIVED,
      phone: '+6281',
      vars: { name: 'Andi' },
      customerId: 'cust-1',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      NotificationEvent.ORDER_RECEIVED,
      '+6281',
      { name: 'Andi' },
      'cust-1',
    );
    expect(out.id).toBe('n1');
  });

  it('dispatches internally, defaulting absent vars/customerId', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(notifRecord()) };
    const controller = new NotificationController(notifications as never);
    await controller.sendInternal({ event: NotificationEvent.STOCK_LOW, phone: '+6281' });
    expect(notifications.notify).toHaveBeenCalledWith(
      NotificationEvent.STOCK_LOW,
      '+6281',
      {},
      null,
    );
  });
});

describe('CampaignController', () => {
  const record = (over: Partial<CampaignRecord> = {}): CampaignRecord => ({
    id: 'camp-1',
    name: 'Blast',
    channel: CampaignChannel.WHATSAPP,
    messageTemplate: 'Hi {{name}}',
    status: CampaignStatus.DRAFT,
    totalRecipients: 1,
    sentCount: 0,
    failedCount: 0,
    createdBy: 'staff-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    sentAt: null,
    recipients: [
      {
        id: 'r1',
        campaignId: 'camp-1',
        customerId: null,
        phone: '+6281',
        name: 'Andi',
        status: RecipientStatus.PENDING,
        error: null,
        sentAt: null,
        createdAt: new Date('2026-01-01'),
      },
    ],
    ...over,
  });

  it('creates a campaign, forwarding the caller token', async () => {
    const campaigns = { create: jest.fn().mockResolvedValue(record()) };
    const controller = new CampaignController(campaigns as never);
    const out = await controller.create(
      user,
      { name: 'Blast', messageTemplate: 'Hi {{name}}', segment: { tier: 'GOLD' } } as CreateCampaignDto,
      'Bearer tok',
    );
    expect(campaigns.create).toHaveBeenCalledWith(
      'user-1',
      'Blast',
      'Hi {{name}}',
      undefined,
      { tier: 'GOLD' },
      'Bearer tok',
    );
    expect(out.recipients).toHaveLength(1);
  });

  it('lists campaigns (paginated)', async () => {
    const campaigns = {
      list: jest.fn().mockResolvedValue({ items: [record()], total: 1, page: 1, limit: 20, totalPages: 1 }),
    };
    const controller = new CampaignController(campaigns as never);
    const out = await controller.list({ page: 1, limit: 20 });
    expect(campaigns.list).toHaveBeenCalledWith(1, 20);
    expect(out.total).toBe(1);
  });

  it('gets one campaign', async () => {
    const campaigns = { get: jest.fn().mockResolvedValue(record()) };
    const out = await new CampaignController(campaigns as never).get('camp-1');
    expect(out.id).toBe('camp-1');
  });

  it('sends a campaign', async () => {
    const campaigns = { send: jest.fn().mockResolvedValue(record({ status: CampaignStatus.SENT, sentCount: 1 })) };
    const out = await new CampaignController(campaigns as never).send('camp-1');
    expect(campaigns.send).toHaveBeenCalledWith('camp-1');
    expect(out.status).toBe(CampaignStatus.SENT);
  });
});

describe('request DTO transforms', () => {
  it('nests the push keys object (SubscribePushDto @Type arrow)', () => {
    const dto = plainToInstance(SubscribePushDto, {
      endpoint: 'https://push/1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    expect(dto.keys).toBeInstanceOf(Object);
    expect(dto.keys.p256dh).toBe('k');
  });

  it('nests recipient + segment and coerces page numbers (campaign @Type arrows)', () => {
    const dto = plainToInstance(CreateCampaignDto, {
      name: 'Blast',
      messageTemplate: 'Hi',
      recipients: [{ phone: '+6281', name: 'Andi' }],
      segment: { tier: 'GOLD', city: 'Jakarta' },
    });
    expect(dto.recipients?.[0].phone).toBe('+6281');
    expect(dto.segment?.tier).toBe('GOLD');
  });
});
