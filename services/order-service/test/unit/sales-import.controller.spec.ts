import { SalesImportController } from '../../src/modules/sales-import.controller';
import { SalesImportService } from '../../src/application/services/sales-import.service';

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const user = { sub: 'staff-1', role: 'MANAGER', phone: '0811' } as never;

function makeController(service: Partial<SalesImportService>) {
  return new SalesImportController(service as SalesImportService);
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

    const result = await controller.list({
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
