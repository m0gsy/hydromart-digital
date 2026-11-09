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

  // ORD-14. `lineTotal` was stored as typed and merged into a depot's revenue, so a row where
  // 2 x 20.000 said 400.000 added 360.000 that was never sold. It is derivable, so a row that
  // disagrees with itself is refused (by name), not guessed at.
  it('refuses a row whose lineTotal is not unitPrice x quantity, naming both numbers', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'x' });
    const service = makeService({ create });
    const summary = await service.importTransactions(user, DEPOT_A, [
      row({ externalRef: 'OK', lineTotal: 40000 }),
      row({ externalRef: 'BAD', lineTotal: 400000 }),
    ]);
    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    const bad = summary.results.find((r) => r.status === 'failed');
    expect(bad?.message).toMatch(/400\.?000/);
    expect(bad?.message).toMatch(/40\.?000/);
  });

  it('tolerates a half-rupiah of rounding either way, but not a whole one', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'x' });
    const service = makeService({ create });
    const summary = await service.importTransactions(user, DEPOT_A, [
      row({ externalRef: 'A', quantity: 3, unitPrice: 3333.33, lineTotal: 10000 }),
      row({ externalRef: 'B', lineTotal: 40001 }),
    ]);
    expect(summary).toMatchObject({ created: 1, failed: 1 });
  });

  // ORD-14. unique(depotId, externalRef) meant a receipt with three products imported its first
  // line and silently "skipped" the other two as duplicates, so revenue was understated with no
  // error. Rows of one receipt now take line numbers in file order; the same file re-imported
  // yields the same numbers, so it is still a no-op.
  it('numbers the rows of one receipt in file order, restarting for the next receipt', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'x' });
    const service = makeService({ create });
    await service.importTransactions(user, DEPOT_A, [
      row({ externalRef: 'INV-1', productLabel: 'Galon' }),
      row({ externalRef: 'INV-1', productLabel: 'Tutup' }),
      row({ externalRef: 'INV-2' }),
      row({ externalRef: 'INV-1', productLabel: 'Segel' }),
    ]);
    expect(create.mock.calls.map((c) => [c[0].externalRef, c[0].lineNo])).toEqual([
      ['INV-1', 0],
      ['INV-1', 1],
      ['INV-2', 0],
      ['INV-1', 2],
    ]);
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
