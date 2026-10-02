import { SalesImportService } from '../../src/application/services/sales-import.service';
import { SalesImportRepository } from '../../src/application/ports/sales-import.repository';

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const user = { sub: 'staff-1', role: 'MANAGER', phone: '0811' } as never;

function makeService(repo: Partial<SalesImportRepository>) {
  return new SalesImportService(repo as SalesImportRepository);
}

const row = (over: Partial<Parameters<SalesImportService['importTransactions']>[2][number]> = {}) => ({
  externalRef: 'INV-001',
  occurredAt: '2026-01-05T00:00:00.000Z',
  productLabel: 'Galon 19L',
  quantity: 2,
  unitPrice: 20000,
  lineTotal: 40000,
  ...over,
});

describe('SalesImportService', () => {
  it('creates a row and tags it with the given depot and a shared batchId across the run', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'x' });
    const service = makeService({ create });

    const summary = await service.importTransactions(user, DEPOT_A, [row(), row({ externalRef: 'INV-002' })]);

    expect(summary).toMatchObject({ created: 2, updated: 0, skipped: 0, failed: 0 });
    expect(create).toHaveBeenCalledTimes(2);
    const [first, second] = create.mock.calls.map((c) => c[0]);
    expect(first.depotId).toBe(DEPOT_A);
    expect(first.importedBy).toBe('staff-1');
    expect(first.batchId).toBe(second.batchId); // one batch per import run
  });

  it('reports a duplicate externalRef as skipped, not failed', async () => {
    const create = jest
      .fn()
      .mockRejectedValue({ code: 'P2002', meta: { target: ['depotId', 'externalRef'] } });
    const service = makeService({ create });

    const summary = await service.importTransactions(user, DEPOT_A, [row()]);

    expect(summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(summary.results[0]).toMatchObject({ status: 'skipped' });
  });

  it('reports any other error as failed, with the message preserved', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db unreachable'));
    const service = makeService({ create });

    const summary = await service.importTransactions(user, DEPOT_A, [row()]);

    expect(summary).toMatchObject({ created: 0, skipped: 0, failed: 1 });
    expect(summary.results[0]).toMatchObject({ status: 'failed', message: 'db unreachable' });
  });

  it('lists imported rows for a depot within a window by delegating to the repository', async () => {
    const listByDepot = jest.fn().mockResolvedValue([{ id: 'r1' }]);
    const service = makeService({ listByDepot });
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');

    const rows = await service.listByDepot(DEPOT_A, from, to);

    expect(listByDepot).toHaveBeenCalledWith(DEPOT_A, { from, to });
    expect(rows).toEqual([{ id: 'r1' }]);
  });

  it('sumByDepot delegates to the repository with an optional window', async () => {
    const sumByDepot = jest.fn().mockResolvedValue([{ depotId: DEPOT_A, orders: 2, revenue: 50000 }]);
    const service = makeService({ sumByDepot });

    const result = await service.sumByDepot();

    expect(sumByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined });
    expect(result).toEqual([{ depotId: DEPOT_A, orders: 2, revenue: 50000 }]);
  });

  it('sumByProduct delegates to the repository with an optional window', async () => {
    const sumByProduct = jest.fn().mockResolvedValue([{ productLabel: 'Galon', orders: 1, revenue: 20000 }]);
    const service = makeService({ sumByProduct });
    const from = new Date('2026-01-01');

    const result = await service.sumByProduct(from);

    expect(sumByProduct).toHaveBeenCalledWith({ from, to: undefined });
    expect(result).toEqual([{ productLabel: 'Galon', orders: 1, revenue: 20000 }]);
  });

  it('sumByMethod delegates to the repository with an optional window', async () => {
    const sumByMethod = jest.fn().mockResolvedValue([{ method: 'CASH', orders: 1, revenue: 10000 }]);
    const service = makeService({ sumByMethod });
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');

    const result = await service.sumByMethod(from, to);

    expect(sumByMethod).toHaveBeenCalledWith({ from, to });
    expect(result).toEqual([{ method: 'CASH', orders: 1, revenue: 10000 }]);
  });
});
