import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../../src/modules/health.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const result = await controller.check();
    expect(result).toMatchObject({
      status: 'ok',
      service: 'order-service',
      checks: { database: 'up' },
    });
    expect(typeof result.timestamp).toBe('string');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('throws 503 with a down database status when the probe rejects', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no db')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await controller.check().catch((err: ServiceUnavailableException) => {
      expect(err.getResponse()).toMatchObject({ status: 'error', checks: { database: 'down' } });
    });
  });
});
