import { DepotDeactivationBlockedError } from '../../src/domain/errors';
import { DepotService } from '../../src/application/services/depot.service';
import { DepotDeactivationPrismaProbe } from '../../src/infrastructure/prisma/depot-deactivation.prisma.probe';
import { InMemoryDepotRepository } from '../support/fakes';

/**
 * DEP-10: DELETE /depots/:id set active=false and nothing else. A depot with a live stock
 * reservation, a purchase order out with the supplier or a transfer in flight was switched
 * off with that work still pointing at it, and nothing said so.
 */
describe('DepotService.deactivate (DEP-10)', () => {
  const create = async (probe?: { blockers: (id: string) => Promise<string[]> }) => {
    const repo = new InMemoryDepotRepository();
    const svc = new DepotService(repo, probe);
    const depot = await svc.create({
      code: 'DEP-10',
      name: 'Depot',
      ownershipType: 'COMPANY_OWNED' as never,
      address: 'Jl. A',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.2,
      lng: 106.8,
      serviceRadiusKm: 5,
      deliveryFee: 0,
    } as never);
    return { svc, depot, repo };
  };

  it('switches off a depot with nothing in flight', async () => {
    const { svc, depot } = await create({ blockers: async () => [] });
    await expect(svc.deactivate(depot.id)).resolves.toMatchObject({ active: false });
  });

  it('refuses, naming every blocker, while work is still in flight', async () => {
    const { svc, depot, repo } = await create({
      blockers: async () => ['3 reservasi stok aktif', '1 transfer stok terkirim'],
    });
    const err = await svc.deactivate(depot.id).catch((e) => e);
    expect(err).toBeInstanceOf(DepotDeactivationBlockedError);
    expect(err.message).toContain('3 reservasi stok aktif');
    expect(err.message).toContain('1 transfer stok terkirim');
    expect(repo.rows.find((r) => r.id === depot.id)?.active).toBe(true);
  });

  it('force switches it off anyway, because a closing depot cannot wait for every PO', async () => {
    const { svc, depot } = await create({ blockers: async () => ['1 PO terkirim'] });
    await expect(svc.deactivate(depot.id, { force: true })).resolves.toMatchObject({ active: false });
  });

  it('without a probe wired (older construction sites) it behaves as before', async () => {
    const { svc, depot } = await create();
    await expect(svc.deactivate(depot.id)).resolves.toMatchObject({ active: false });
  });
});

describe('DepotDeactivationPrismaProbe (DEP-10)', () => {
  const prisma = {
    stockReservation: { count: jest.fn() },
    purchaseOrder: { count: jest.fn() },
    stockTransfer: { count: jest.fn() },
  };
  const probe = new DepotDeactivationPrismaProbe(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('counts live reservations, sent POs and in-flight transfers on either side', async () => {
    prisma.stockReservation.count.mockResolvedValue(2);
    prisma.purchaseOrder.count.mockResolvedValue(1);
    prisma.stockTransfer.count.mockResolvedValue(4);
    await expect(probe.blockers('d1')).resolves.toEqual([
      '2 reservasi stok aktif',
      '1 pesanan pembelian (PO) terkirim',
      '4 transfer stok terkirim',
    ]);
    expect(prisma.stockReservation.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', item: { depotId: 'd1' } },
    });
    expect(prisma.purchaseOrder.count).toHaveBeenCalledWith({
      where: { depotId: 'd1', status: 'SENT' },
    });
    expect(prisma.stockTransfer.count).toHaveBeenCalledWith({
      where: { status: 'SENT', OR: [{ fromDepotId: 'd1' }, { toDepotId: 'd1' }] },
    });
  });

  it('says nothing when nothing is in flight', async () => {
    prisma.stockReservation.count.mockResolvedValue(0);
    prisma.purchaseOrder.count.mockResolvedValue(0);
    prisma.stockTransfer.count.mockResolvedValue(0);
    await expect(probe.blockers('d1')).resolves.toEqual([]);
  });
});
