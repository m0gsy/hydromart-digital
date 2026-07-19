import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../../src/modules/health.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('HealthController', () => {
  const prisma = { $queryRaw: jest.fn() };
  const controller = new HealthController(prisma as unknown as PrismaService);

  afterEach(() => jest.clearAllMocks());

  it('reports ok when the database query succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const result = await controller.check();
    expect(result).toMatchObject({
      status: 'ok',
      service: 'promo-service',
      checks: { database: 'up' },
    });
  });

  it('throws 503 with a down status when the database query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('no db'));
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await controller.check().catch((err: ServiceUnavailableException) => {
      expect(err.getResponse()).toMatchObject({ status: 'error', checks: { database: 'down' } });
    });
  });
});
