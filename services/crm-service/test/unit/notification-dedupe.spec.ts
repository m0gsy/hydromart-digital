import { NotificationPrismaRepository } from '../../src/infrastructure/prisma/notification.prisma.repository';

const base = {
  event: 'ORDER_RECEIVED',
  customerId: null,
  phone: '+6281',
  message: 'm',
  status: 'SENT',
  error: null,
  destination: null,
  depotId: null,
} as never;
const row = {
  id: 'n-1',
  event: 'ORDER_RECEIVED',
  customerId: null,
  phone: '+6281',
  message: 'm',
  status: 'SENT',
  error: null,
  destination: null,
  depotId: null,
  createdAt: new Date('2026-10-30'),
};

describe('NotificationPrismaRepository.recordOnce', () => {
  const notification = { create: jest.fn(), findUnique: jest.fn() };
  const repo = new NotificationPrismaRepository({ notification } as never);

  beforeEach(() => jest.clearAllMocks());

  it('without a key it is a plain append', async () => {
    notification.create.mockResolvedValue(row);
    const out = await repo.recordOnce(base);
    expect(out.created).toBe(true);
    expect(notification.create.mock.calls[0][0].data.dedupeKey).toBeUndefined();
  });

  it('stores the key with the row', async () => {
    notification.create.mockResolvedValue(row);
    await repo.recordOnce({ ...(base as object), dedupeKey: 'k-1' } as never);
    expect(notification.create.mock.calls[0][0].data.dedupeKey).toBe('k-1');
  });

  it('a repeated key returns the existing row and says nothing was created', async () => {
    notification.create.mockRejectedValue(Object.assign(new Error('u'), { code: 'P2002' }));
    notification.findUnique.mockResolvedValue(row);
    const out = await repo.recordOnce({ ...(base as object), dedupeKey: 'k-1' } as never);
    expect(out).toMatchObject({ created: false, record: { id: 'n-1' } });
    expect(notification.findUnique).toHaveBeenCalledWith({ where: { dedupeKey: 'k-1' } });
  });

  it('rethrows a unique violation with no row behind it, and any other failure', async () => {
    notification.create.mockRejectedValue(Object.assign(new Error('u'), { code: 'P2002' }));
    notification.findUnique.mockResolvedValue(null);
    await expect(
      repo.recordOnce({ ...(base as object), dedupeKey: 'k-1' } as never),
    ).rejects.toThrow('u');
    notification.create.mockRejectedValue(new Error('db down'));
    await expect(
      repo.recordOnce({ ...(base as object), dedupeKey: 'k-1' } as never),
    ).rejects.toThrow('db down');
  });
});
