import { GallonNetworkService } from '../../src/application/services/gallon-network.service';
import { GallonIssueDepotRow, GallonIssueRepository } from '../../src/application/ports/gallon-issue.repository';
import { GallonReturnDepotRow, GallonReturnRepository } from '../../src/application/ports/gallon-return.repository';

// Only networkSummary() is exercised; the rest of each repo port is irrelevant to the
// rollup, so the fakes stub just that one method.
const issues = (rows: GallonIssueDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonIssueRepository;
const returns = (rows: GallonReturnDepotRow[]) =>
  ({ networkSummary: async () => rows }) as unknown as GallonReturnRepository;

describe('GallonNetworkService.outstanding', () => {
  it('merges issue + return rows per depot into outstanding + net deposit', async () => {
    const service = new GallonNetworkService(
      issues([{ depotId: 'd1', gallons: 100, depositHeld: 500000 }]),
      returns([{ depotId: 'd1', gallons: 40, depositRefunded: 200000 }]),
    );
    const [row] = await service.outstanding();
    expect(row).toEqual({
      depotId: 'd1',
      issued: 100,
      returned: 40,
      outstanding: 60,
      depositHeld: 500000,
      depositRefunded: 200000,
      netDeposit: 300000,
    });
  });

  it('floors outstanding and net deposit at zero when returns exceed issues', async () => {
    const service = new GallonNetworkService(
      issues([{ depotId: 'd1', gallons: 10, depositHeld: 50000 }]),
      returns([{ depotId: 'd1', gallons: 25, depositRefunded: 120000 }]),
    );
    const [row] = await service.outstanding();
    expect(row.outstanding).toBe(0);
    expect(row.netDeposit).toBe(0);
  });

  it('includes a depot present only in returns (empties handed back, none issued this window)', async () => {
    const service = new GallonNetworkService(
      issues([]),
      returns([{ depotId: 'd2', gallons: 5, depositRefunded: 25000 }]),
    );
    const [row] = await service.outstanding();
    expect(row).toMatchObject({ depotId: 'd2', issued: 0, returned: 5, outstanding: 0 });
  });

  it('emits one row per depot across both sources', async () => {
    const service = new GallonNetworkService(
      issues([
        { depotId: 'd1', gallons: 30, depositHeld: 0 },
        { depotId: 'd2', gallons: 10, depositHeld: 0 },
      ]),
      returns([{ depotId: 'd3', gallons: 4, depositRefunded: 0 }]),
    );
    const ids = (await service.outstanding()).map((r) => r.depotId).sort();
    expect(ids).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns an empty array when there is no activity', async () => {
    const service = new GallonNetworkService(issues([]), returns([]));
    expect(await service.outstanding()).toEqual([]);
  });
});
