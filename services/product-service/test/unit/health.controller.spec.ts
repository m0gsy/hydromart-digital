import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../../src/modules/health.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('HealthController', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports ok when the database query succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);

    const result = await controller.check();

    expect(result).toMatchObject({
      status: 'ok',
      service: 'product-service',
      checks: { database: 'up' },
    });
    expect(typeof result.timestamp).toBe('string');
  });

  it('throws 503 with a down database when the query fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no db')) };
    const controller = new HealthController(prisma as unknown as PrismaService);

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    try {
      await controller.check();
    } catch (err) {
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        status: 'error',
        checks: { database: 'down' },
      });
    }
  });
});
