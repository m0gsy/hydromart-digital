import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/** Gap-fill: the Nest lifecycle hooks connect/disconnect (no real DB touched). */
describe('PrismaService lifecycle', () => {
  it('connects on module init', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined as never);
    await svc.onModuleInit();
    expect(connect).toHaveBeenCalled();
  });

  it('disconnects on module destroy', async () => {
    const svc = new PrismaService();
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined as never);
    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalled();
  });
});
