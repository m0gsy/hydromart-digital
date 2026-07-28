import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// Exercises the Nest lifecycle wiring without touching a real database: we stub the
// inherited PrismaClient $connect/$disconnect so onModuleInit/onModuleDestroy run their
// connect-and-log / disconnect paths in isolation.

describe('PrismaService', () => {
  it('onModuleInit connects to the database', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined as never);
    await service.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy disconnects from the database', async () => {
    const service = new PrismaService();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined as never);
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
