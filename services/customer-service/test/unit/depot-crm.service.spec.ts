import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { DepotCrmRepository, DepotCustomerRow } from '../../src/application/ports/depot-crm.repository';

// Minimal fake: only findIdsByDepot is exercised here; the other deps are unused by this method.
class FakeDepotCrmRepository implements DepotCrmRepository {
  byDepot = new Map<string, string[]>();
  async listDepotCustomers(): Promise<DepotCustomerRow[]> {
    return [];
  }
  async findIdsByDepot(depotId: string): Promise<string[]> {
    return this.byDepot.get(depotId) ?? [];
  }
}

describe('DepotCrmService.listCustomerIdsByDepot', () => {
  it('returns only the ids whose favourite depot matches', async () => {
    const repo = new FakeDepotCrmRepository();
    repo.byDepot.set('depot-a', ['c1', 'c2']);
    repo.byDepot.set('depot-b', ['c3']);
    const service = new DepotCrmService(repo, {} as never, {} as never);

    expect(await service.listCustomerIdsByDepot('depot-a')).toEqual(['c1', 'c2']);
    expect(await service.listCustomerIdsByDepot('depot-b')).toEqual(['c3']);
    expect(await service.listCustomerIdsByDepot('depot-unknown')).toEqual([]);
  });
});
