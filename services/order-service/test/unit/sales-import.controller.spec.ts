import { ForbiddenException } from '@nestjs/common';

import { SalesImportController } from '../../src/modules/sales-import.controller';
import { DepotDirectoryPort } from '../../src/application/ports/depot-directory.port';
import { SalesImportService } from '../../src/application/services/sales-import.service';

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const user = { sub: 'staff-1', role: 'MANAGER', phone: '0811' } as never;

function makeController(service: Partial<SalesImportService>, depots: Partial<DepotDirectoryPort> = {}) {
  return new SalesImportController(service as SalesImportService, depots as DepotDirectoryPort);
}

describe('SalesImportController', () => {
  it('import delegates to the service with the caller and the body', async () => {
    const importTransactions = jest.fn().mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, results: [] });
    const controller = makeController({ importTransactions });

    await controller.import(user, { depotId: DEPOT_A, rows: [] } as never);

    expect(importTransactions).toHaveBeenCalledWith(user, DEPOT_A, []);
  });

  it('list parses the query window and delegates to the service', async () => {
    const listByDepot = jest.fn().mockResolvedValue([{ id: 'r1' }]);
    const controller = makeController({ listByDepot });

    const result = await controller.list(user, {
      depotId: DEPOT_A,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    } as never);

    expect(listByDepot).toHaveBeenCalledWith(
      DEPOT_A,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-02-01T00:00:00.000Z'),
    );
    expect(result).toEqual([{ id: 'r1' }]);
  });

  // Owner decision 2026-11-20: a franchise owner imports the history of a depot they OWN.
  describe('a franchise owner', () => {
    const owner = { sub: 'own-1', role: 'FRANCHISE_OWNER', phone: '0812' } as never;
    const ownership = (ownerId: string | null, others: string[] = []) => ({
      findOwner: jest.fn().mockResolvedValue({
        ownerId,
        owners: others.map((o) => ({ ownerId: o, sharePct: 50, isPrimary: false })),
        ownershipType: 'WARALABA',
      }),
    });

    it('imports into and lists a depot they own (as primary or co-owner)', async () => {
      const importTransactions = jest.fn().mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, results: [] });
      const listByDepot = jest.fn().mockResolvedValue([]);
      await makeController({ importTransactions }, ownership('own-1')).import(owner, { depotId: DEPOT_A, rows: [] } as never);
      expect(importTransactions).toHaveBeenCalled();
      await makeController({ listByDepot }, ownership('someone', ['own-1'])).list(owner, {
        depotId: DEPOT_A,
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      } as never);
      expect(listByDepot).toHaveBeenCalled();
    });

    it("is refused another owner's depot, and a depot whose ownership cannot be read", async () => {
      const importTransactions = jest.fn();
      await expect(
        makeController({ importTransactions }, ownership('someone-else')).import(owner, { depotId: DEPOT_A, rows: [] } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        makeController({ importTransactions }, { findOwner: jest.fn().mockResolvedValue(null) }).import(owner, {
          depotId: DEPOT_A,
          rows: [],
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(importTransactions).not.toHaveBeenCalled();
    });

    it('does not ask for ownership for any other role', async () => {
      const findOwner = jest.fn();
      const importTransactions = jest.fn().mockResolvedValue({ created: 0, updated: 0, skipped: 0, failed: 0, results: [] });
      await makeController({ importTransactions }, { findOwner }).import(user, { depotId: DEPOT_A, rows: [] } as never);
      expect(findOwner).not.toHaveBeenCalled();
    });
  });

  describe('summaryByMethod', () => {
    it('maps the service rows to the shared label/orders/revenue shape', async () => {
      const sumByMethod = jest
        .fn()
        .mockResolvedValue([{ method: 'CASH', orders: 3, revenue: 60000 }]);
      const controller = makeController({ sumByMethod });

      const result = await controller.summaryByMethod({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      expect(sumByMethod).toHaveBeenCalledWith(
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-02-01T00:00:00.000Z'),
      );
      expect(result).toEqual({ rows: [{ label: 'CASH', orders: 3, revenue: 60000 }] });
    });

    it('passes undefined bounds through when the window is omitted', async () => {
      const sumByMethod = jest.fn().mockResolvedValue([]);
      const controller = makeController({ sumByMethod });

      await controller.summaryByMethod({});

      expect(sumByMethod).toHaveBeenCalledWith(undefined, undefined);
    });
  });
});
