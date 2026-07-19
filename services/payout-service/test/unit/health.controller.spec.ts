import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../../src/modules/health.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('HealthController', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const res = await controller.check();
    expect(res).toMatchObject({
      status: 'ok',
      service: 'payout-service',
      checks: { database: 'up' },
    });
    expect(typeof res.timestamp).toBe('string');
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
