import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// Lifecycle hooks only: onModuleInit must open the pool ($connect), onModuleDestroy
// must close it ($disconnect). No real database — the PrismaClient methods are spied.
describe('PrismaService lifecycle', () => {
  it('onModuleInit connects to the database', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
    await svc.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy disconnects from the database', async () => {
    const svc = new PrismaService();
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined);
    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
