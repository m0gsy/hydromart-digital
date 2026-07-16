import { PriceOverrideService } from '../../src/application/services/price-override.service';
import { PricingService, CreateRuleInput } from '../../src/application/services/pricing.service';
import { PricingAdjustType } from '../../src/domain/pricing-rule';
import { PriceOverrideStatus } from '../../src/domain/price-override-proposal';
import {
  DepotNotFoundError,
  PriceOverrideProposalDecidedError,
  PriceOverrideProposalNotFoundError,
} from '../../src/domain/errors';
import {
  CreatePriceOverrideProposalData,
  ListProposalsFilter,
  PriceOverrideProposalRepository,
  UpdatePriceOverrideProposalData,
} from '../../src/application/ports/price-override-proposal.repository';
import { PriceOverrideProposalRecord } from '../../src/domain/price-override-proposal';
import { DepotRecord, DepotRepository } from '../../src/application/ports/depot.repository';

class InMemoryProposalRepository implements PriceOverrideProposalRepository {
  rows: PriceOverrideProposalRecord[] = [];
  private seq = 0;

  async create(data: CreatePriceOverrideProposalData): Promise<PriceOverrideProposalRecord> {
    const at = new Date(1_800_000_000_000 + this.seq * 1000);
    const row: PriceOverrideProposalRecord = {
      id: `p${++this.seq}`,
      ...data,
      status: PriceOverrideStatus.PENDING,
      decidedBy: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return row;
  }
  async list(filter: ListProposalsFilter) {
    const all = this.rows
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return { items: all.slice(start, start + filter.limit), total: all.length };
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, patch: UpdatePriceOverrideProposalData) {
    const row = this.rows.find((r) => r.id === id)!;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.decidedBy !== undefined) row.decidedBy = patch.decidedBy;
    return row;
  }
}

// Only findById is exercised; the rest throw if reached.
const fakeDepots = (name: string | null): DepotRepository =>
  ({
    findById: async (id: string) =>
      name === null ? null : ({ id, name } as unknown as DepotRecord),
  }) as unknown as DepotRepository;

const PROPOSE = {
  productId: '11111111-1111-1111-1111-111111111111',
  productName: 'Galon 19L isi ulang',
  currentPrice: 20000,
  adjustType: PricingAdjustType.PERCENT,
  value: -10,
  note: 'ikut harga pesaing',
};

describe('PriceOverrideService', () => {
  let repo: InMemoryProposalRepository;
  let pricingCreate: jest.Mock;
  let pricing: PricingService;

  beforeEach(() => {
    repo = new InMemoryProposalRepository();
    pricingCreate = jest.fn(async (_depotId: string, _input: CreateRuleInput) => ({}) as never);
    pricing = { create: pricingCreate } as unknown as PricingService;
  });

  const service = (depotName: string | null = 'Depot Kelapa Gading') =>
    new PriceOverrideService(repo, fakeDepots(depotName), pricing);

  it('proposes an override, denormalizing the depot name', async () => {
    const created = await service().propose('d1', 'mgr-1', PROPOSE);
    expect(created.status).toBe(PriceOverrideStatus.PENDING);
    expect(created.depotName).toBe('Depot Kelapa Gading');
    expect(created.proposedBy).toBe('mgr-1');
  });

  it('rejects a proposal for an unknown depot', async () => {
    await expect(service(null).propose('d0', 'mgr-1', PROPOSE)).rejects.toBeInstanceOf(
      DepotNotFoundError,
    );
  });

  it('approving creates the winning pricing rule and marks it APPROVED', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.approve(created.id, 'hq-1');

    expect(decided.status).toBe(PriceOverrideStatus.APPROVED);
    expect(decided.decidedBy).toBe('hq-1');
    expect(pricingCreate).toHaveBeenCalledTimes(1);
    const [depotId, input] = pricingCreate.mock.calls[0] as [string, CreateRuleInput];
    expect(depotId).toBe('d1');
    expect(input).toMatchObject({
      productId: PROPOSE.productId,
      adjustType: PricingAdjustType.PERCENT,
      value: -10,
      priority: 100,
      active: true,
    });
  });

  it('rejecting closes the proposal without creating a rule', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    const decided = await svc.reject(created.id, 'hq-1');
    expect(decided.status).toBe(PriceOverrideStatus.REJECTED);
    expect(pricingCreate).not.toHaveBeenCalled();
  });

  it('refuses to re-decide a terminal proposal', async () => {
    const svc = service();
    const created = await svc.propose('d1', 'mgr-1', PROPOSE);
    await svc.approve(created.id, 'hq-1');
    await expect(svc.reject(created.id, 'hq-1')).rejects.toBeInstanceOf(
      PriceOverrideProposalDecidedError,
    );
  });

  it('rejects an unknown proposal id', async () => {
    await expect(service().approve('missing', 'hq-1')).rejects.toBeInstanceOf(
      PriceOverrideProposalNotFoundError,
    );
  });

  it('lists the pending queue newest-first', async () => {
    const svc = service();
    await svc.propose('d1', 'mgr-1', { ...PROPOSE, productName: 'Oldest' });
    await svc.propose('d1', 'mgr-1', { ...PROPOSE, productName: 'Newest' });
    const page = await svc.list({ page: 1, limit: 20, status: PriceOverrideStatus.PENDING });
    expect(page.total).toBe(2);
    expect(page.items[0].productName).toBe('Newest');
  });
});
