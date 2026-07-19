import { CampaignChannel } from '../../src/domain/channel';
import { CampaignStatus } from '../../src/domain/campaign-status';
import { RecipientStatus } from '../../src/domain/recipient-status';
import { BroadcastLevel } from '../../src/domain/broadcast-level';
import { NotificationStatus } from '../../src/domain/notification-status';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignPrismaRepository } from '../../src/infrastructure/prisma/campaign.prisma.repository';
import { NotificationPrismaRepository } from '../../src/infrastructure/prisma/notification.prisma.repository';
import { BroadcastPrismaRepository } from '../../src/infrastructure/prisma/broadcast.prisma.repository';
import { PushSubscriptionPrismaRepository } from '../../src/infrastructure/prisma/push.prisma.repository';

const recipientRow = () => ({
  id: 'rcpt-1',
  campaignId: 'camp-1',
  customerId: 'cust-1',
  phone: '+6281234567890',
  name: 'Budi',
  status: 'PENDING',
  error: null,
  sentAt: null,
  createdAt: new Date('2026-01-01'),
});

const campaignRow = () => ({
  id: 'camp-1',
  name: 'Promo Ramadan',
  channel: 'WHATSAPP',
  messageTemplate: 'Hi {{name}}',
  status: 'DRAFT',
  totalRecipients: 1,
  sentCount: 0,
  failedCount: 0,
  createdBy: 'staff-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  sentAt: null,
});

describe('CampaignPrismaRepository', () => {
  const campaign = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const campaignRecipient = {
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    campaign,
    campaignRecipient,
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  const repo = new CampaignPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('creates a campaign atomically and maps enums + recipients', async () => {
    const created = { ...campaignRow(), recipients: [recipientRow()] };
    campaign.create.mockResolvedValue(created);
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(prisma));

    const record = await repo.create({
      createdBy: 'staff-1',
      name: 'Promo Ramadan',
      messageTemplate: 'Hi {{name}}',
      recipients: [{ customerId: 'cust-1', phone: '+6281234567890', name: 'Budi' }, { phone: '+62800' }],
    });

    expect(campaign.create).toHaveBeenCalledWith({
      data: {
        name: 'Promo Ramadan',
        messageTemplate: 'Hi {{name}}',
        createdBy: 'staff-1',
        totalRecipients: 2,
        recipients: {
          create: [
            { customerId: 'cust-1', phone: '+6281234567890', name: 'Budi' },
            { customerId: null, phone: '+62800', name: null },
          ],
        },
      },
      include: { recipients: { orderBy: { createdAt: 'asc' } } },
    });
    expect(record.channel).toBe(CampaignChannel.WHATSAPP);
    expect(record.status).toBe(CampaignStatus.DRAFT);
    expect(record.recipients[0].status).toBe(RecipientStatus.PENDING);
  });

  it('findById maps the row when present', async () => {
    campaign.findUnique.mockResolvedValue({ ...campaignRow(), recipients: [recipientRow()] });
    const record = await repo.findById('camp-1');
    expect(campaign.findUnique).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      include: { recipients: { orderBy: { createdAt: 'asc' } } },
    });
    expect(record?.id).toBe('camp-1');
    expect(record?.recipients).toHaveLength(1);
  });

  it('findById returns null when absent', async () => {
    campaign.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByIdRecipients maps recipient rows', async () => {
    campaignRecipient.findMany.mockResolvedValue([recipientRow()]);
    const rows = await repo.findByIdRecipients('camp-1');
    expect(campaignRecipient.findMany).toHaveBeenCalledWith({
      where: { campaignId: 'camp-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows[0].status).toBe(RecipientStatus.PENDING);
  });

  it('list paginates via $transaction and omits recipients', async () => {
    (prisma.$transaction as jest.Mock).mockResolvedValue([[campaignRow()], 5]);
    const result = await repo.list(2, 10);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(campaign.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(campaign.count).toHaveBeenCalled();
    expect(result.total).toBe(5);
    expect(result.items[0].recipients).toEqual([]);
  });

  it('markSending flips status to SENDING', async () => {
    campaign.update.mockResolvedValue(campaignRow());
    await repo.markSending('camp-1');
    expect(campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: 'SENDING' },
    });
  });

  it('recordRecipientResult persists a recipient outcome', async () => {
    campaignRecipient.update.mockResolvedValue(recipientRow());
    const sentAt = new Date('2026-02-02');
    await repo.recordRecipientResult('rcpt-1', RecipientStatus.SENT, null, sentAt);
    expect(campaignRecipient.update).toHaveBeenCalledWith({
      where: { id: 'rcpt-1' },
      data: { status: 'SENT', error: null, sentAt },
    });
  });

  it('finalize flips to SENT with final counts', async () => {
    const sentAt = new Date('2026-02-03');
    campaign.update.mockResolvedValue({ ...campaignRow(), status: 'SENT', recipients: [] });
    const record = await repo.finalize('camp-1', 3, 1, sentAt);
    expect(campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: 'SENT', sentCount: 3, failedCount: 1, sentAt },
      include: { recipients: { orderBy: { createdAt: 'asc' } } },
    });
    expect(record.status).toBe(CampaignStatus.SENT);
  });
});

describe('NotificationPrismaRepository', () => {
  const notification = {
    create: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = { notification } as unknown as PrismaService;
  const repo = new NotificationPrismaRepository(prisma);
  const notifRow = () => ({
    id: 'notif-1',
    event: 'order.confirmed',
    customerId: 'cust-1',
    phone: '+6281234567890',
    message: 'Order confirmed',
    status: 'SENT',
    error: null,
    createdAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('record appends and maps the status enum', async () => {
    notification.create.mockResolvedValue(notifRow());
    const record = await repo.record({
      event: 'order.confirmed',
      customerId: 'cust-1',
      phone: '+6281234567890',
      message: 'Order confirmed',
      status: NotificationStatus.SENT,
      error: null,
    });
    expect(notification.create).toHaveBeenCalledWith({
      data: {
        event: 'order.confirmed',
        customerId: 'cust-1',
        phone: '+6281234567890',
        message: 'Order confirmed',
        status: 'SENT',
        error: null,
      },
    });
    expect(record.status).toBe(NotificationStatus.SENT);
  });

  it('listForCustomer returns the newest-first feed', async () => {
    notification.findMany.mockResolvedValue([notifRow()]);
    const rows = await repo.listForCustomer('cust-1', 20);
    expect(notification.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    expect(rows[0].status).toBe(NotificationStatus.SENT);
  });

  it('listForCustomer maps empty result', async () => {
    notification.findMany.mockResolvedValue([]);
    expect(await repo.listForCustomer('cust-1', 20)).toEqual([]);
  });

  it('listByEvents filters by the events set', async () => {
    notification.findMany.mockResolvedValue([{ ...notifRow(), status: 'FAILED' }]);
    const rows = await repo.listByEvents(['order.confirmed', 'order.delivered'], 5);
    expect(notification.findMany).toHaveBeenCalledWith({
      where: { event: { in: ['order.confirmed', 'order.delivered'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    expect(rows[0].status).toBe(NotificationStatus.FAILED);
  });
});

describe('BroadcastPrismaRepository', () => {
  const depotBroadcast = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };
  const depotBroadcastRead = {
    upsert: jest.fn(),
  };
  const prisma = { depotBroadcast, depotBroadcastRead } as unknown as PrismaService;
  const repo = new BroadcastPrismaRepository(prisma);
  const bcastRow = () => ({
    id: 'bc-1',
    depotId: 'depot-1',
    title: 'Shift change',
    body: 'Report at 7am',
    level: 'URGENT',
    createdBy: 'mgr-1',
    createdAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('create persists and maps the level enum', async () => {
    depotBroadcast.create.mockResolvedValue(bcastRow());
    const record = await repo.create({
      depotId: 'depot-1',
      title: 'Shift change',
      body: 'Report at 7am',
      level: BroadcastLevel.URGENT,
      createdBy: 'mgr-1',
    });
    expect(depotBroadcast.create).toHaveBeenCalledWith({
      data: {
        depotId: 'depot-1',
        title: 'Shift change',
        body: 'Report at 7am',
        level: 'URGENT',
        createdBy: 'mgr-1',
      },
    });
    expect(record.level).toBe(BroadcastLevel.URGENT);
  });

  it('findById maps the row when present', async () => {
    depotBroadcast.findUnique.mockResolvedValue({ ...bcastRow(), level: 'INFO' });
    const record = await repo.findById('bc-1');
    expect(depotBroadcast.findUnique).toHaveBeenCalledWith({ where: { id: 'bc-1' } });
    expect(record?.level).toBe(BroadcastLevel.INFO);
  });

  it('findById returns null when absent', async () => {
    depotBroadcast.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('listForCourier annotates readAt from the read receipt', async () => {
    const readAt = new Date('2026-02-01');
    depotBroadcast.findMany.mockResolvedValue([
      { ...bcastRow(), reads: [{ readAt }] },
      { ...bcastRow(), id: 'bc-2', reads: [] },
    ]);
    const rows = await repo.listForCourier('depot-1', 'courier-1', 10);
    expect(depotBroadcast.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { reads: { where: { courierId: 'courier-1' }, select: { readAt: true } } },
    });
    expect(rows[0].readAt).toBe(readAt);
    expect(rows[1].readAt).toBeNull();
  });

  it('markRead upserts an idempotent read receipt', async () => {
    depotBroadcastRead.upsert.mockResolvedValue({});
    const readAt = new Date('2026-02-01');
    await repo.markRead('bc-1', 'courier-1', readAt);
    expect(depotBroadcastRead.upsert).toHaveBeenCalledWith({
      where: { broadcastId_courierId: { broadcastId: 'bc-1', courierId: 'courier-1' } },
      create: { broadcastId: 'bc-1', courierId: 'courier-1', readAt },
      update: {},
    });
  });
});

describe('PushSubscriptionPrismaRepository', () => {
  const webPushSubscription = {
    upsert: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const prisma = { webPushSubscription } as unknown as PrismaService;
  const repo = new PushSubscriptionPrismaRepository(prisma);
  const subRow = () => ({
    id: 'sub-1',
    customerId: 'cust-1',
    endpoint: 'https://push.example/abc',
    p256dh: 'key',
    auth: 'secret',
    extra: 'ignored',
  });
  const subData = {
    customerId: 'cust-1',
    endpoint: 'https://push.example/abc',
    p256dh: 'key',
    auth: 'secret',
  };

  beforeEach(() => jest.clearAllMocks());

  it('upsert registers/re-points an endpoint and maps the record', async () => {
    webPushSubscription.upsert.mockResolvedValue(subRow());
    const record = await repo.upsert(subData);
    expect(webPushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/abc' },
      create: subData,
      update: { customerId: 'cust-1', p256dh: 'key', auth: 'secret' },
    });
    expect(record).toEqual({
      id: 'sub-1',
      customerId: 'cust-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'key',
      auth: 'secret',
    });
  });

  it('listForCustomer maps every row', async () => {
    webPushSubscription.findMany.mockResolvedValue([subRow(), { ...subRow(), id: 'sub-2' }]);
    const rows = await repo.listForCustomer('cust-1');
    expect(webPushSubscription.findMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
    expect(rows).toHaveLength(2);
    expect(rows[1].id).toBe('sub-2');
  });

  it('deleteByEndpoint removes matching subscriptions', async () => {
    webPushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    await repo.deleteByEndpoint('https://push.example/abc');
    expect(webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/abc' },
    });
  });
});
